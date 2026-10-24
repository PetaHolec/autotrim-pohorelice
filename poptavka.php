<?php
/**
 * Poptávka dílu – zpracování formuláře z index.html.
 * Ověří údaje, uloží poptávku do _poptavky/poptavky.csv (+ fotku) a pošle e-mail prodejně.
 * Odpovídá JSONem (fetch z main.js), bez JavaScriptu přesměruje zpět na stránku.
 */
declare(strict_types=1);
mb_internal_encoding('UTF-8');
date_default_timezone_set('Europe/Prague');

$cfg = require __DIR__ . '/poptavka-config.php';
$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

function respond(bool $ok, int $code = 200, string $message = '', array $errors = []): never
{
    global $wantsJson;
    http_response_code($code);
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message, 'errors' => $errors ?: null], JSON_UNESCAPED_UNICODE);
    } else {
        header('Location: index.html?' . ($ok ? 'odeslano=1' : 'chyba=1') . '#poptavka', true, 303);
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(false, 405, 'Formulář se odesílá metodou POST.');
}

$in = static fn(string $k, int $max): string => mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', (string)($_POST[$k] ?? ''))), 0, $max);

// --- ochrana proti spamu: skryté pole + příliš rychlé odeslání ---
if ($in('web', 200) !== '') {
    respond(true); // robotovi tváříme úspěch
}
$ts = (int)($_POST['ts'] ?? 0);
if ($ts > 0 && (microtime(true) * 1000 - $ts) < 2500) {
    respond(true);
}

// --- údaje ---
$d = [
    'typ'     => $in('typ', 20),
    'znacka'  => $in('znacka', 60),
    'model'   => $in('model', 80),
    'rok'     => $in('rok', 4),
    'motor'   => $in('motor', 80),
    'vin'     => strtoupper(preg_replace('/\s+/', '', $in('vin', 30))),
    'skupina' => $in('skupina', 40),
    'dil'     => $in('dil', 2000),
    'cislo'   => $in('cislo', 80),
    'jmeno'   => $in('jmeno', 80),
    'telefon' => $in('telefon', 20),
    'email'   => $in('email', 120),
];
$skupiny = ['', 'Brzdy', 'Filtry', 'Oleje a kapaliny', 'Zapalování a žhavení', 'Podvozek a tlumiče', 'Spojka a rozvody', 'Osvětlení a elektro', 'Stěrače', 'Výbava a autodoplňky', 'Jiné'];
if (!in_array($d['typ'], ['Osobní', 'Užitkové'], true)) $d['typ'] = '';

$err = [];
if ($d['znacka'] === '') $err['znacka'] = 'Vyplňte značku vozu.';
if ($d['model'] === '') $err['model'] = 'Vyplňte model vozu.';
if ($d['rok'] !== '' && (!preg_match('/^(19|20)\d{2}$/', $d['rok']) || (int)$d['rok'] > (int)date('Y') + 1)) $err['rok'] = 'Zadejte platný rok výroby.';
if ($d['vin'] !== '' && !preg_match('/^[A-HJ-NPR-Z0-9]{17}$/', $d['vin'])) $err['vin'] = 'VIN má 17 znaků (bez písmen I, O, Q).';
if (!in_array($d['skupina'], $skupiny, true)) $d['skupina'] = '';
if ($d['dil'] === '') $err['dil'] = 'Napište, jaký díl sháníte.';
if ($d['jmeno'] === '') $err['jmeno'] = 'Vyplňte jméno.';
if (preg_match_all('/\d/', $d['telefon']) < 9 || !preg_match('/^[+\d\s()\/-]+$/', $d['telefon'])) $err['telefon'] = 'Zadejte platné telefonní číslo.';
if ($d['email'] !== '' && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) $err['email'] = 'E-mail nemá správný tvar.';
if (($_POST['souhlas'] ?? '') !== '1') $err['souhlas'] = 'Bez souhlasu nemůžeme poptávku zpracovat.';

// --- fotka (nepovinná) ---
$photo = null;
$f = $_FILES['foto'] ?? null;
if ($f && ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
    $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'image/heif' => 'heif'];
    $mime = ($f['error'] === UPLOAD_ERR_OK && is_uploaded_file($f['tmp_name'])) ? (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) : '';
    if ($f['error'] !== UPLOAD_ERR_OK || $f['size'] > $cfg['max_photo'] || !isset($types[$mime])) {
        $err['foto'] = 'Fotka může mít nejvýš 8 MB (JPG, PNG, WEBP nebo HEIC).';
    } else {
        $photo = ['tmp' => $f['tmp_name'], 'mime' => $mime, 'ext' => $types[$mime]];
    }
}

if ($err) {
    respond(false, 422, 'Zkontrolujte prosím označená pole.', $err);
}

// --- úložiště + omezení četnosti ---
$dir = rtrim($cfg['store_dir'], '/');
if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
    respond(false, 500, 'Poptávku se nepodařilo uložit. Zavolejte nám prosím na 519 425 986.');
}
if (!file_exists("$dir/.htaccess")) {
    file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n");
    file_put_contents("$dir/index.html", '');
}
$ipKey = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . __FILE__);
$throttleFile = "$dir/.throttle.json";
$seen = is_file($throttleFile) ? (json_decode((string)file_get_contents($throttleFile), true) ?: []) : [];
$now = time();
$seen = array_filter($seen, static fn($t) => $now - $t < 3600);
if (isset($seen[$ipKey]) && $now - $seen[$ipKey] < $cfg['throttle']) {
    respond(false, 429, 'Poptávku jste právě odeslali. Další můžete poslat za chvíli, nebo zavolejte na 519 425 986.');
}
$seen[$ipKey] = $now;
file_put_contents($throttleFile, json_encode($seen), LOCK_EX);

$id = date('Ymd-His') . '-' . bin2hex(random_bytes(2));
$photoName = '';
if ($photo) {
    $photoName = "foto-$id.{$photo['ext']}";
    move_uploaded_file($photo['tmp'], "$dir/$photoName");
}

// CSV (středník, UTF-8 s BOM – otevře se rovnou v Excelu)
$csv = "$dir/poptavky.csv";
$fh = fopen($csv, 'ab');
if ($fh) {
    flock($fh, LOCK_EX);
    if (filesize($csv) === 0) {
        fwrite($fh, "\xEF\xBB\xBF");
        fputcsv($fh, ['ID', 'Datum', 'Typ vozidla', 'Značka', 'Model', 'Rok', 'Motor', 'VIN', 'Skupina', 'Díl', 'Číslo dílu', 'Jméno', 'Telefon', 'E-mail', 'Fotka'], ';', '"', '');
    }
    $safe = static fn(string $v): string => preg_match('/^[=+\-@\t\r]/', $v) ? "'$v" : $v;
    fputcsv($fh, array_map($safe, [$id, date('j. n. Y H:i'), $d['typ'], $d['znacka'], $d['model'], $d['rok'], $d['motor'], $d['vin'], $d['skupina'], $d['dil'], $d['cislo'], $d['jmeno'], $d['telefon'], $d['email'], $photoName]), ';', '"', '');
    flock($fh, LOCK_UN);
    fclose($fh);
}

// --- e-mail prodejně ---
$to = trim((string)$cfg['to']);
if ($to !== '') {
    $rows = [
        'Vozidlo' => $d['typ'], 'Značka' => $d['znacka'], 'Model' => $d['model'], 'Rok výroby' => $d['rok'], 'Motor' => $d['motor'], 'VIN' => $d['vin'],
        'Skupina' => $d['skupina'], 'Číslo dílu' => $d['cislo'],
    ];
    $text = "Nová poptávka dílu z webu ($id)\n\n== VOZIDLO A DÍL ==\n";
    foreach ($rows as $k => $v) {
        if ($v !== '') $text .= str_pad($k . ':', 14) . $v . "\n";
    }
    $text .= "\nPožadovaný díl:\n" . $d['dil'] . "\n\n== ZÁKAZNÍK ==\n";
    $text .= 'Jméno:        ' . $d['jmeno'] . "\nTelefon:      " . $d['telefon'] . "\n";
    if ($d['email'] !== '') $text .= 'E-mail:       ' . $d['email'] . "\n";
    $text .= "\nOdesláno: " . date('j. n. Y H:i') . ($photoName ? "\nFotka dílu je v příloze." : '') . "\n";

    $subject = mb_encode_mimeheader('Poptávka: ' . $d['znacka'] . ' ' . $d['model'] . ' – ' . mb_strimwidth($d['dil'], 0, 50, '…'), 'UTF-8', 'B', "\r\n");
    $fromName = mb_encode_mimeheader($cfg['from_name'], 'UTF-8', 'B');
    $headers = [
        'From' => "$fromName <{$cfg['from']}>",
        'MIME-Version' => '1.0',
        'X-Mailer' => 'Autotrim web',
    ];
    if ($d['email'] !== '') {
        $headers['Reply-To'] = $d['email'];
    }

    if ($photoName) {
        $b = 'b' . bin2hex(random_bytes(12));
        $headers['Content-Type'] = "multipart/mixed; boundary=\"$b\"";
        $body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text))
            . "--$b\r\nContent-Type: {$photo['mime']}; name=\"$photoName\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$photoName\"\r\n\r\n"
            . chunk_split(base64_encode((string)file_get_contents("$dir/$photoName")))
            . "--$b--\r\n";
    } else {
        $headers['Content-Type'] = 'text/plain; charset=UTF-8';
        $headers['Content-Transfer-Encoding'] = 'base64';
        $body = chunk_split(base64_encode($text));
    }

    if (!mail($to, $subject, $body, $headers)) {
        error_log("poptavka.php: mail() selhal pro $id");
        // poptávka je uložená v CSV, zákazníkovi přesto potvrdíme přijetí
    }
}

respond(true, 200, 'Poptávka odeslána.');
