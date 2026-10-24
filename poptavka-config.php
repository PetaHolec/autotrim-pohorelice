<?php
// Nastavení formuláře „Poptávka dílu“ (poptavka.php).
return [
    // Kam se posílají poptávky. Více adres oddělte čárkou.
    // Každá poptávka se navíc ukládá do složky _poptavky/ (CSV).
    'to' => 'autotrim@seznam.cz',

    // Odesílatel e-mailu – adresa na doméně webu (kvůli doručitelnosti).
    'from' => 'poptavky@' . preg_replace('/^www\./', '', $_SERVER['SERVER_NAME'] ?? 'localhost'),
    'from_name' => 'Web Autotrim',

    // Složka pro archiv poptávek (CSV + fotky), chráněná .htaccess.
    'store_dir' => __DIR__ . '/_poptavky',

    // Maximální velikost fotky v bajtech.
    'max_photo' => 8 * 1024 * 1024,

    // Minimální odstup dvou poptávek ze stejné IP (sekundy).
    'throttle' => 30,
];
