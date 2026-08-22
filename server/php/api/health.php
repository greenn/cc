<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

try {
    $db = cc_db();
    $sqliteVersion = (string)$db->query('SELECT sqlite_version()')->fetchColumn();
    cc_json([
        'ok' => true,
        'service' => 'cc-backend',
        'php' => PHP_VERSION,
        'pdo_sqlite' => extension_loaded('pdo_sqlite'),
        'sqlite' => $sqliteVersion,
        'time' => gmdate('c'),
    ]);
} catch (Throwable $e) {
    cc_error('Backend is not ready: ' . $e->getMessage(), 500, [
        'php' => PHP_VERSION,
        'pdo_sqlite' => extension_loaded('pdo_sqlite'),
    ]);
}
