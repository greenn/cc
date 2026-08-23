<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");

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

function vk_auth_base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function vk_auth_render(string $title, string $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');

    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . vk_auth_escape($title) . '</title>';
    echo '<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fa;color:#111;margin:0;padding:32px}.card{max-width:760px;margin:40px auto;background:#fff;border:1px solid #e4e7eb;padding:28px;box-shadow:0 18px 50px rgba(20,40,70,.08)}h1{font-size:24px;margin:0 0 14px}p{line-height:1.55;color:#444}.ok{color:#137333}.warn{color:#9a6700}.bad{color:#b42318}.token{width:100%;min-height:96px;box-sizing:border-box;padding:12px;border:1px solid #ccd1d8;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.button{display:inline-block;margin-top:12px;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border:0;cursor:pointer}.secondary{background:#fff;color:#111;border:1px solid #ccd1d8}.meta{font-size:13px;color:#666}code{background:#f2f4f7;padding:2px 5px}</style></head><body><main class="card">';
    echo $body;
    echo '</main></body></html>';
    exit;
}

function vk_auth_http_post(string $url, array $form): array
{
    $body = http_build_query($form, '', '&', PHP_QUERY_RFC3986);

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('Could not initialize cURL.');
        }

        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
                'Accept: application/json',
                'User-Agent: CC-Comment-Collection/0.3.5',
            ],
        ]);

        $raw = curl_exec($curl);
        if ($raw === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new RuntimeException('VK request failed: ' . $error);
        }

        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return [$status, (string)$raw];
    }

    if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        throw new RuntimeException('Hosting needs PHP cURL or allow_url_fopen for VK OAuth.');
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json\r\nUser-Agent: CC-Comment-Collection/0.3.5\r\n",
            'content' => $body,
            'timeout' => 30,
            'ignore_errors' => true,
        ],
    ]);

    $raw = file_get_contents($url, false, $context);
    if ($raw === false) {
        throw new RuntimeException('VK request failed through PHP stream transport.');
    }

    $status = 200;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
                $status = (int)$match[1];
                break;
            }
        }
    }

    return [$status, (string)$raw];
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
        '<h1>VK OAuth is not configured</h1>'
        . '<p class="bad">Add your VK application ID to <code>config.php</code>:</p>'
        . '<pre><code>\'vk_client_id\' =&gt; \'YOUR_APP_ID\',\n\'vk_redirect_uri\' =&gt; \'https://backend83.nadube.ru/cc/api/vk-auth.php\',</code></pre>',
        503
    );
}

if (!str_starts_with($redirectUri, 'https://')) {
    vk_auth_render('Invalid VK redirect URI', '<h1>Invalid redirect URI</h1><p class="bad">VK redirect URI must use HTTPS.</p>', 500);
}

if ($action === 'start') {
    $state = vk_auth_base64url(random_bytes(32));
    $verifier = vk_auth_base64url(random_bytes(64));
    $challenge = vk_auth_base64url(hash('sha256', $verifier, true));

    $_SESSION['vk_oauth_state'] = $state;
    $_SESSION['vk_code_verifier'] = $verifier;
    $_SESSION['vk_oauth_created_at'] = time();

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
    vk_auth_render('VK authorization failed', '<h1>VK authorization failed</h1><p class="bad"><strong>' . $error . '</strong>: ' . $description . '</p><a class="button secondary" href="?action=start">Try again</a>', 400);
}

$code = trim((string)($params['code'] ?? ''));
$state = trim((string)($params['state'] ?? ''));
$deviceId = trim((string)($params['device_id'] ?? ''));

if ($code === '') {
    $body = '<h1>CC VK authorization</h1>'
        . '<p>This helper uses VK ID OAuth 2.1 with PKCE. It obtains a user access token that CC can test with the VK API.</p>'
        . '<p class="meta">Redirect URI: <code>' . vk_auth_escape($redirectUri) . '</code></p>'
        . '<a class="button" href="?action=start">Connect VK</a>';
    vk_auth_render('CC VK authorization', $body);
}

$expectedState = (string)($_SESSION['vk_oauth_state'] ?? '');
$verifier = (string)($_SESSION['vk_code_verifier'] ?? '');
$createdAt = (int)($_SESSION['vk_oauth_created_at'] ?? 0);

if ($expectedState === '' || $verifier === '' || $createdAt < time() - 900) {
    vk_auth_render('VK authorization session expired', '<h1>Authorization session expired</h1><p class="bad">Start VK authorization again.</p><a class="button secondary" href="?action=start">Start again</a>', 400);
}

if ($state === '' || !hash_equals($expectedState, $state)) {
    vk_auth_render('VK state mismatch', '<h1>Security check failed</h1><p class="bad">OAuth state does not match. Start authorization again.</p><a class="button secondary" href="?action=start">Start again</a>', 400);
}

if ($deviceId === '') {
    vk_auth_render('VK device_id missing', '<h1>VK callback is incomplete</h1><p class="bad">VK did not return <code>device_id</code>. Start authorization again.</p><a class="button secondary" href="?action=start">Start again</a>', 400);
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

    [$status, $raw] = vk_auth_http_post('https://id.vk.ru/oauth2/auth?' . $tokenQuery, ['code' => $code]);
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

    unset($_SESSION['vk_oauth_state'], $_SESSION['vk_code_verifier'], $_SESSION['vk_oauth_created_at']);

    $probeText = 'Classic VK API compatibility was not checked.';
    $probeClass = 'warn';
    try {
        [$probeStatus, $probeRaw] = vk_auth_http_post('https://api.vk.ru/method/users.get', [
            'access_token' => $accessToken,
            'v' => '5.199',
        ]);
        $probeData = json_decode($probeRaw, true, 512, JSON_THROW_ON_ERROR);
        if ($probeStatus < 400 && isset($probeData['response'])) {
            $probeText = 'Classic VK API accepts this token (users.get succeeded).';
            $probeClass = 'ok';
        } elseif (isset($probeData['error'])) {
            $probeText = 'Classic VK API rejected this token: ' . (string)($probeData['error']['error_msg'] ?? 'VK API error') . ' (code ' . (string)($probeData['error']['error_code'] ?? '?') . ').';
            $probeClass = 'bad';
        }
    } catch (Throwable $probeError) {
        $probeText = 'Could not run the VK API compatibility probe: ' . $probeError->getMessage();
    }

    $userId = vk_auth_escape((string)($tokenData['user_id'] ?? 'unknown'));
    $expiresIn = vk_auth_escape((string)($tokenData['expires_in'] ?? 'unknown'));
    $safeToken = vk_auth_escape($accessToken);

    $body = '<h1>VK authorization completed</h1>'
        . '<p class="ok">A user access token was received.</p>'
        . '<p class="' . $probeClass . '">' . vk_auth_escape($probeText) . '</p>'
        . '<p class="meta">VK user: <code>' . $userId . '</code> · expires in: <code>' . $expiresIn . '</code> seconds</p>'
        . '<p>Copy this token directly into <strong>CC → Settings → VK user access token</strong>. Do not send it in chat or commit it to GitHub.</p>'
        . '<textarea id="token" class="token" readonly>' . $safeToken . '</textarea>'
        . '<button class="button" type="button" onclick="navigator.clipboard.writeText(document.getElementById(\'token\').value).then(()=>this.textContent=\'Copied\')">Copy token</button>'
        . '<a class="button secondary" href="?action=start">Authorize again</a>';

    vk_auth_render('VK authorization completed', $body);
} catch (Throwable $e) {
    unset($_SESSION['vk_oauth_state'], $_SESSION['vk_code_verifier'], $_SESSION['vk_oauth_created_at']);
    vk_auth_render(
        'VK token exchange failed',
        '<h1>VK token exchange failed</h1><p class="bad">' . vk_auth_escape($e->getMessage()) . '</p><a class="button secondary" href="?action=start">Start again</a>',
        502
    );
}
