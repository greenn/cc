<?php

declare(strict_types=1);

$checks = [];

function add_check(array &$checks, string $name, bool $ok, string $details): void
{
    $checks[] = ['name' => $name, 'ok' => $ok, 'details' => $details];
}

add_check($checks, 'PHP version', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION . ' (recommended: 8.1+)');
add_check($checks, 'PDO', extension_loaded('pdo'), extension_loaded('pdo') ? 'enabled' : 'missing');
add_check($checks, 'PDO SQLite', extension_loaded('pdo_sqlite'), extension_loaded('pdo_sqlite') ? 'enabled' : 'missing');
add_check($checks, 'SQLite3 extension', extension_loaded('sqlite3'), extension_loaded('sqlite3') ? 'enabled' : 'not required if PDO SQLite works');
add_check($checks, 'JSON', extension_loaded('json'), extension_loaded('json') ? 'enabled' : 'missing');
add_check($checks, 'mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'enabled' : 'optional');

$hasCurl = function_exists('curl_init');
$hasUrlFopen = filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN);
add_check(
    $checks,
    'Outbound HTTPS transport',
    $hasCurl || $hasUrlFopen,
    $hasCurl ? 'cURL enabled — VK proxy supported' : ($hasUrlFopen ? 'allow_url_fopen enabled — VK proxy supported' : 'need PHP cURL or allow_url_fopen for VK API proxy')
);

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0770, true);
}
add_check($checks, 'Data directory', is_dir($dataDir), $dataDir);
add_check($checks, 'Data directory writable', is_dir($dataDir) && is_writable($dataDir), is_writable($dataDir) ? 'writable' : 'not writable');

$sqliteTestOk = false;
$sqliteDetails = 'not tested';
if (extension_loaded('pdo_sqlite') && is_dir($dataDir) && is_writable($dataDir)) {
    $testFile = $dataDir . '/cc-check-' . bin2hex(random_bytes(4)) . '.sqlite';
    try {
        $pdo = new PDO('sqlite:' . $testFile, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        $stmt = $pdo->prepare('INSERT INTO test(value) VALUES (?)');
        $stmt->execute(['ok']);
        $value = $pdo->query('SELECT value FROM test LIMIT 1')->fetchColumn();
        $version = $pdo->query('SELECT sqlite_version()')->fetchColumn();
        $sqliteTestOk = $value === 'ok';
        $sqliteDetails = 'read/write OK; SQLite ' . $version;
        $pdo = null;
        @unlink($testFile);
    } catch (Throwable $e) {
        $sqliteDetails = $e->getMessage();
        @unlink($testFile);
    }
}
add_check($checks, 'SQLite read/write test', $sqliteTestOk, $sqliteDetails);

$configExists = is_file(__DIR__ . '/config.php');
add_check($checks, 'config.php', $configExists, $configExists ? 'found' : 'missing — copy config.example.php to config.php');

$requiredNames = ['PHP version', 'PDO', 'PDO SQLite', 'JSON', 'Outbound HTTPS transport', 'Data directory', 'Data directory writable', 'SQLite read/write test'];
$ready = true;
foreach ($checks as $check) {
    if (in_array($check['name'], $requiredNames, true) && !$check['ok']) {
        $ready = false;
    }
}

if (isset($_GET['json'])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ready' => $ready, 'checks' => $checks], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CC backend check</title>
  <style>
    body{font:15px/1.45 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#161616;background:#f7f7f7}
    main{background:#fff;border:1px solid #ddd;padding:28px}h1{margin-top:0}.status{font-size:22px;font-weight:700;padding:14px 16px;margin:18px 0;background:#f1f1f1}.ok{color:#176b2c}.bad{color:#a32626}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e8e8e8;vertical-align:top}code{background:#f2f2f2;padding:2px 5px}small{color:#666}
  </style>
</head>
<body>
<main>
  <h1>CC backend compatibility check</h1>
  <div class="status <?= $ready ? 'ok' : 'bad' ?>"><?= $ready ? 'READY' : 'NOT READY' ?></div>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>
    <?php foreach ($checks as $check): ?>
      <tr>
        <td><?= htmlspecialchars($check['name'], ENT_QUOTES, 'UTF-8') ?></td>
        <td class="<?= $check['ok'] ? 'ok' : 'bad' ?>"><?= $check['ok'] ? 'OK' : 'FAIL' ?></td>
        <td><?= htmlspecialchars($check['details'], ENT_QUOTES, 'UTF-8') ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <p><strong>Required for CC:</strong> PHP 8.1+, PDO, PDO SQLite, JSON, a writable SQLite directory, and cURL or allow_url_fopen for outbound VK API requests.</p>
  <p>After setup, copy <code>config.example.php</code> to <code>config.php</code>, set a long API token, then open <code>api/health.php</code>.</p>
  <p><small>You may delete or rename this checker after setup if you do not want hosting details publicly visible.</small></p>
</main>
</body>
</html>
