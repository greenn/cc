<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/vk-oauth.php';

header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");

$cookiePath = '/cc/api/';
if (isset($_SERVER['SCRIPT_NAME'])) {
    $dir = str_replace('\\', '/', dirname((string)$_SERVER['SCRIPT_NAME']));
    if ($dir !== '.' && $dir !== DIRECTORY_SEPARATOR) {
        $cookiePath = rtrim($dir, '/') . '/';
    }
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name('cc_vk_oauth');
    session_set_cookie_params([
        'lifetime' => 900,
        'path' => $cookiePath,
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function vk_auth_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function vk_auth_render(string $title, string $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . vk_auth_escape($title) . '</title>';
    echo '<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fa;color:#111;margin:0;padding:32px}.card{max-width:760px;margin:40px auto;background:#fff;border:1px solid #e4e7eb;padding:28px;box-shadow:0 18px 50px rgba(20,40,70,.08)}h1{font-size:24px;margin:0 0 14px}p{line-height:1.55;color:#444}.ok{color:#137333}.warn{color:#9a6700}.bad{color:#b42318}.button{display:inline-block;margin-top:12px;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border:0;cursor:pointer}.secondary{background:#fff;color:#111;border:1px solid #ccd1d8}.meta{font-size:13px;color:#666}code{background:#f2f4f7;padding:2px 5px}</style></head><body><main class="card">';
    echo $body;
    echo '</main></body></html>';
    exit;
}

function vk_auth_callback_params(): array
{
    $params = $_GET;
    $payload = $params['payload'] ?? null;
    if (is_string($payload) && $payload !== '') {
        $decoded = json_decode($payload, true);
        if (!is_array($decoded)) {
            $decoded = json_decode(urldecode($payload), true);
        }
        if (is_array($decoded)) {
            $params = array_merge($params, $decoded);
        }
    }
    return $params;
}

$config = cc_config();
$clientId = trim((string)($config['vk_client_id'] ?? ''));
$redirectUri = trim((string)($config['vk_redirect_uri'] ?? 'https://backend83.nadube.ru/cc/api/vk-auth.php'));
$scope = trim((string)($config['vk_oauth_scope'] ?? ''));
$params = vk_auth_callback_params();
$action = trim((string)($params['action'] ?? ''));

if ($clientId === '' || !preg_match('/^\d+$/', $clientId)) {
    vk_auth_render(
        'VK OAuth is not configured',
        '<h1>VK OAuth is not configured</h1><p class="bad">Add your VK ID application ID to <code>config.php</code>.</p>',
        503
    );
}

if (!str_starts_with($redirectUri, 'https://')) {
    vk_auth_render('Invalid VK redirect URI', '<h1>Invalid redirect URI</h1><p class="bad">VK redirect URI must use HTTPS.</p>', 500);
}

if ($action === 'start') {
    $ticket = trim((string)($params['ticket'] ?? ''));
    $profile = cc_vk_consume_ticket($ticket);
    if ($profile === null) {
        vk_auth_render(
            'VK connection link expired',
            '<h1>Connection link expired</h1><p class="bad">Start VK connection again from CC → Settings.</p>',
            403
        );
    }

    $state = cc_vk_base64url(random_bytes(32));
    $verifier = cc_vk_base64url(random_bytes(64));
    $challenge = cc_vk_base64url(hash('sha256', $verifier, true));

    $_SESSION['vk_oauth_state'] = $state;
    $_SESSION['vk_code_verifier'] = $verifier;
    $_SESSION['vk_oauth_created_at'] = time();
    $_SESSION['vk_profile'] = $profile;

    $query = [
        'client_id' => $clientId,
        'app_id' => $clientId,
        'response_type' => 'code',
        'redirect_uri' => $redirectUri,
        'code_challenge' => $challenge,
        'code_challenge_method' => 's256',
        'state' => $state,
    ];
    if ($scope !== '') {
        $query['scope'] = $scope;
    }

    header('Location: https://id.vk.ru/authorize?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), true, 302);
    exit;
}

if (isset($params['error'])) {
    $error = vk_auth_escape((string)$params['error']);
    $description = vk_auth_escape((string)($params['error_description'] ?? 'VK authorization was cancelled or failed.'));
    vk_auth_render('VK authorization failed', '<h1>VK authorization failed</h1><p class="bad"><strong>' . $error . '</strong>: ' . $description . '</p><p>Return to CC Settings and try Connect VK again.</p>', 400);
}

$code = trim((string)($params['code'] ?? ''));
$state = trim((string)($params['state'] ?? ''));
$deviceId = trim((string)($params['device_id'] ?? ''));

if ($code === '') {
    vk_auth_render(
        'CC VK authorization',
        '<h1>CC VK authorization</h1><p>Start VK connection from <strong>CC → Settings → VK</strong>. The protected connection link is created there.</p><p class="meta">Redirect URI: <code>' . vk_auth_escape($redirectUri) . '</code></p>'
    );
}

$expectedState = (string)($_SESSION['vk_oauth_state'] ?? '');
$verifier = (string)($_SESSION['vk_code_verifier'] ?? '');
$createdAt = (int)($_SESSION['vk_oauth_created_at'] ?? 0);
$profile = (string)($_SESSION['vk_profile'] ?? '');

if ($expectedState === '' || $verifier === '' || $profile === '' || $createdAt < time() - 900) {
    vk_auth_render('VK authorization session expired', '<h1>Authorization session expired</h1><p class="bad">Return to CC Settings and start VK connection again.</p>', 400);
}

if ($state === '' || !hash_equals($expectedState, $state)) {
    vk_auth_render('VK state mismatch', '<h1>Security check failed</h1><p class="bad">OAuth state does not match. Return to CC Settings and reconnect VK.</p>', 400);
}

if ($deviceId === '') {
    vk_auth_render('VK device_id missing', '<h1>VK callback is incomplete</h1><p class="bad">VK did not return <code>device_id</code>. Return to CC Settings and reconnect VK.</p>', 400);
}

try {
    $tokenQuery = http_build_query([
        'grant_type' => 'authorization_code',
        'redirect_uri' => $redirectUri,
        'client_id' => $clientId,
        'code_verifier' => $verifier,
        'state' => $state,
        'device_id' => $deviceId,
    ], '', '&', PHP_QUERY_RFC3986);

    [$status, $raw] = cc_vk_http_post('https://id.vk.ru/oauth2/auth?' . $tokenQuery, ['code' => $code]);
    $tokenData = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status >= 400 || isset($tokenData['error'])) {
        $message = (string)($tokenData['error_description'] ?? $tokenData['error'] ?? ('HTTP ' . $status));
        throw new RuntimeException($message);
    }

    $returnedState = trim((string)($tokenData['state'] ?? ''));
    if ($returnedState !== '' && !hash_equals($expectedState, $returnedState)) {
        throw new RuntimeException('VK token response state mismatch.');
    }

    $accessToken = trim((string)($tokenData['access_token'] ?? ''));
    if ($accessToken === '') {
        throw new RuntimeException('VK did not return an access token.');
    }

    $stored = cc_vk_save_tokens($profile, $tokenData, $deviceId);
    unset($_SESSION['vk_oauth_state'], $_SESSION['vk_code_verifier'], $_SESSION['vk_oauth_created_at'], $_SESSION['vk_profile']);

    $probeText = 'Classic VK API compatibility was not checked.';
    $probeClass = 'warn';
    try {
        [$probeStatus, $probeRaw] = cc_vk_http_post('https://api.vk.ru/method/users.get', [
            'access_token' => $accessToken,
            'v' => '5.199',
        ]);
        $probeData = json_decode($probeRaw, true, 512, JSON_THROW_ON_ERROR);
        if ($probeStatus < 400 && isset($probeData['response'])) {
            $probeText = 'Classic VK API accepts this token.';
            $probeClass = 'ok';
        } elseif (isset($probeData['error'])) {
            $probeText = 'Classic VK API rejected this token: ' . (string)($probeData['error']['error_msg'] ?? 'VK API error') . '.';
            $probeClass = 'bad';
        }
    } catch (Throwable $probeError) {
        $probeText = 'Could not run the VK API compatibility probe: ' . $probeError->getMessage();
    }

    $refreshText = $stored['autoRefresh']
        ? 'Automatic token refresh is enabled. You do not need to copy or renew the access token manually.'
        : 'VK did not return a refresh token. Reconnect may be required after the access token expires.';
    $refreshClass = $stored['autoRefresh'] ? 'ok' : 'warn';
    $userId = vk_auth_escape((string)($stored['userId'] ?? 'unknown'));

    vk_auth_render(
        'VK authorization completed',
        '<h1>VK authorization completed</h1>'
        . '<p class="ok">VK is connected to CC profile <code>' . vk_auth_escape($profile) . '</code>.</p>'
        . '<p class="' . $probeClass . '">' . vk_auth_escape($probeText) . '</p>'
        . '<p class="' . $refreshClass . '">' . vk_auth_escape($refreshText) . '</p>'
        . '<p class="meta">VK user: <code>' . $userId . '</code></p>'
        . '<p>You can close this tab and return to CC. The access token and refresh token are stored only on your CC backend and are never shown to the browser app.</p>'
    );
} catch (Throwable $e) {
    unset($_SESSION['vk_oauth_state'], $_SESSION['vk_code_verifier'], $_SESSION['vk_oauth_created_at'], $_SESSION['vk_profile']);
    vk_auth_render(
        'VK token exchange failed',
        '<h1>VK token exchange failed</h1><p class="bad">' . vk_auth_escape($e->getMessage()) . '</p><p>Return to CC Settings and try Connect VK again.</p>',
        502
    );
}
