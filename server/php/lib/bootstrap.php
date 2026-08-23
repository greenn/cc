<?php

declare(strict_types=1);

const CC_BACKEND = true;

function cc_root(): string
{
    return dirname(__DIR__);
}

function cc_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $local = cc_root() . '/config.php';
    $example = cc_root() . '/config.example.php';

    if (is_file($local)) {
        $config = require $local;
    } else {
        $config = require $example;
    }

    if (!is_array($config)) {
        throw new RuntimeException('CC backend config must return an array.');
    }

    return $config;
}

function cc_json(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cc_error(string $message, int $status = 400, array $extra = []): never
{
    cc_json(['ok' => false, 'error' => $message] + $extra, $status);
}

function cc_apply_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    $allowed = cc_config()['allowed_origins'] ?? [];
    if (!in_array($origin, $allowed, true)) {
        cc_error('Origin is not allowed.', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Max-Age: 86400');
}

function cc_handle_options(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function cc_bearer_token(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';

    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }

    if (preg_match('/^Bearer\s+(.+)$/i', trim($header), $match)) {
        return trim($match[1]);
    }

    return '';
}

function cc_require_auth(): void
{
    $expected = trim((string)(cc_config()['api_token'] ?? ''));
    if ($expected === '' || str_starts_with($expected, 'CHANGE-ME')) {
        cc_error('API token is not configured on the server.', 503);
    }

    $provided = cc_bearer_token();
    if ($provided === '' || !hash_equals($expected, $provided)) {
        header('WWW-Authenticate: Bearer realm="CC"');
        cc_error('Unauthorized.', 401);
    }
}

function cc_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!extension_loaded('pdo_sqlite')) {
        throw new RuntimeException('PHP extension pdo_sqlite is not enabled.');
    }

    $path = (string)(cc_config()['db_path'] ?? '');
    if ($path === '') {
        throw new RuntimeException('db_path is not configured.');
    }

    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
        throw new RuntimeException('Could not create SQLite directory: ' . $dir);
    }

    if (!is_writable($dir)) {
        throw new RuntimeException('SQLite directory is not writable: ' . $dir);
    }

    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = DELETE');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS app_state (
            profile TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );

    return $pdo;
}

function cc_profile(): string
{
    $profile = trim((string)($_GET['profile'] ?? cc_config()['default_profile'] ?? 'default'));
    if ($profile === '') {
        $profile = 'default';
    }

    if (!preg_match('/^[a-zA-Z0-9._-]{1,64}$/', $profile)) {
        cc_error('Invalid profile. Use only letters, numbers, dot, underscore, and hyphen.', 422);
    }

    return $profile;
}

function cc_read_json_body(): array
{
    $max = (int)(cc_config()['max_body_bytes'] ?? 20 * 1024 * 1024);
    $length = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
    if ($length > $max) {
        cc_error('Request body is too large.', 413, ['maxBytes' => $max]);
    }

    $raw = file_get_contents('php://input');
    if ($raw === false) {
        cc_error('Could not read request body.', 400);
    }

    if (strlen($raw) > $max) {
        cc_error('Request body is too large.', 413, ['maxBytes' => $max]);
    }

    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        cc_error('Invalid JSON: ' . $e->getMessage(), 400);
    }

    if (!is_array($data)) {
        cc_error('JSON body must be an object.', 422);
    }

    return $data;
}

function cc_sanitize_state(array $state): array
{
    if (isset($state['settings']) && is_array($state['settings'])) {
        // API keys and backend/VK credentials stay outside synchronized state.
        unset($state['settings']['youtubeApiKey']);
        unset($state['settings']['serverApiToken']);
        unset($state['settings']['apiToken']);
        unset($state['settings']['backendToken']);
        unset($state['settings']['vkAccessToken']);
    }

    return $state;
}

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
cc_apply_cors();
cc_handle_options();
