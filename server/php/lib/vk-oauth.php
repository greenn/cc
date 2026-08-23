<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function cc_vk_base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function cc_vk_profile_name(string $value): string
{
    $profile = trim($value);
    if ($profile === '') {
        $profile = (string)(cc_config()['default_profile'] ?? 'default');
    }

    if (!preg_match('/^[a-zA-Z0-9._-]{1,64}$/', $profile)) {
        throw new InvalidArgumentException('Invalid VK profile name.');
    }

    return $profile;
}

function cc_vk_http_post(string $url, array $form): array
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
                'User-Agent: CC-Comment-Collection/0.3.7',
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
        throw new RuntimeException('Hosting needs PHP cURL or allow_url_fopen for VK requests.');
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json\r\nUser-Agent: CC-Comment-Collection/0.3.7\r\n",
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

function cc_vk_ensure_schema(): PDO
{
    $pdo = cc_db();

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS vk_oauth_tokens (
            profile TEXT PRIMARY KEY,
            user_id TEXT,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL DEFAULT \'\',
            device_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS vk_oauth_tickets (
            ticket_hash TEXT PRIMARY KEY,
            profile TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )'
    );

    return $pdo;
}

function cc_vk_save_tokens(string $profile, array $tokenData, string $deviceId, ?string $fallbackRefreshToken = null): array
{
    $profile = cc_vk_profile_name($profile);
    $accessToken = trim((string)($tokenData['access_token'] ?? ''));
    $refreshToken = trim((string)($tokenData['refresh_token'] ?? $fallbackRefreshToken ?? ''));
    $userId = trim((string)($tokenData['user_id'] ?? ''));
    $returnedDeviceId = trim((string)($tokenData['device_id'] ?? ''));
    if ($returnedDeviceId !== '') {
        $deviceId = $returnedDeviceId;
    }

    if ($accessToken === '') {
        throw new RuntimeException('VK did not return an access token.');
    }
    if ($deviceId === '') {
        throw new RuntimeException('VK device_id is missing.');
    }

    $expiresIn = max(60, (int)($tokenData['expires_in'] ?? 3600));
    $expiresAt = time() + $expiresIn;
    $now = gmdate('c');

    $pdo = cc_vk_ensure_schema();
    $statement = $pdo->prepare(
        'INSERT INTO vk_oauth_tokens (profile, user_id, access_token, refresh_token, device_id, expires_at, created_at, updated_at)
         VALUES (:profile, :user_id, :access_token, :refresh_token, :device_id, :expires_at, :created_at, :updated_at)
         ON CONFLICT(profile) DO UPDATE SET
            user_id = excluded.user_id,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            device_id = excluded.device_id,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at'
    );
    $statement->execute([
        ':profile' => $profile,
        ':user_id' => $userId,
        ':access_token' => $accessToken,
        ':refresh_token' => $refreshToken,
        ':device_id' => $deviceId,
        ':expires_at' => $expiresAt,
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);

    return cc_vk_status($profile);
}

function cc_vk_token_row(string $profile): ?array
{
    $profile = cc_vk_profile_name($profile);
    $pdo = cc_vk_ensure_schema();
    $statement = $pdo->prepare('SELECT * FROM vk_oauth_tokens WHERE profile = :profile LIMIT 1');
    $statement->execute([':profile' => $profile]);
    $row = $statement->fetch();
    return is_array($row) ? $row : null;
}

function cc_vk_status(string $profile): array
{
    $profile = cc_vk_profile_name($profile);
    $row = cc_vk_token_row($profile);
    if (!$row) {
        return [
            'connected' => false,
            'profile' => $profile,
            'userId' => null,
            'expiresAt' => null,
            'expiresIn' => null,
            'autoRefresh' => false,
        ];
    }

    $expiresAt = (int)$row['expires_at'];
    return [
        'connected' => true,
        'profile' => $profile,
        'userId' => $row['user_id'] !== '' ? (string)$row['user_id'] : null,
        'expiresAt' => gmdate('c', $expiresAt),
        'expiresIn' => max(0, $expiresAt - time()),
        'autoRefresh' => trim((string)$row['refresh_token']) !== '',
    ];
}

function cc_vk_refresh_access_token(string $profile, bool $force = false): string
{
    $profile = cc_vk_profile_name($profile);
    $row = cc_vk_token_row($profile);
    if (!$row) {
        throw new RuntimeException('VK is not connected for this CC profile. Open Settings → VK → Connect VK.');
    }

    $accessToken = trim((string)$row['access_token']);
    $expiresAt = (int)$row['expires_at'];
    if (!$force && $accessToken !== '' && $expiresAt > time() + 120) {
        return $accessToken;
    }

    $refreshToken = trim((string)$row['refresh_token']);
    if ($refreshToken === '') {
        throw new RuntimeException('VK refresh token is unavailable. Reconnect VK in CC Settings.');
    }

    $config = cc_config();
    $clientId = trim((string)($config['vk_client_id'] ?? ''));
    $redirectUri = trim((string)($config['vk_redirect_uri'] ?? ''));
    $deviceId = trim((string)$row['device_id']);
    if ($clientId === '' || $redirectUri === '' || $deviceId === '') {
        throw new RuntimeException('VK OAuth server configuration is incomplete.');
    }

    $state = cc_vk_base64url(random_bytes(32));
    $query = http_build_query([
        'grant_type' => 'refresh_token',
        'redirect_uri' => $redirectUri,
        'client_id' => $clientId,
        'device_id' => $deviceId,
        'state' => $state,
    ], '', '&', PHP_QUERY_RFC3986);

    [$status, $raw] = cc_vk_http_post('https://id.vk.ru/oauth2/auth?' . $query, [
        'refresh_token' => $refreshToken,
    ]);

    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status >= 400 || isset($data['error'])) {
        $message = (string)($data['error_description'] ?? $data['error'] ?? ('HTTP ' . $status));
        throw new RuntimeException('VK token refresh failed: ' . $message);
    }

    $returnedState = trim((string)($data['state'] ?? ''));
    if ($returnedState !== '' && !hash_equals($state, $returnedState)) {
        throw new RuntimeException('VK refresh response state mismatch.');
    }

    cc_vk_save_tokens($profile, $data, $deviceId, $refreshToken);
    return trim((string)$data['access_token']);
}

function cc_vk_create_ticket(string $profile): string
{
    $profile = cc_vk_profile_name($profile);
    $ticket = cc_vk_base64url(random_bytes(32));
    $hash = hash('sha256', $ticket);
    $now = time();
    $pdo = cc_vk_ensure_schema();
    $pdo->prepare('DELETE FROM vk_oauth_tickets WHERE expires_at < :now')->execute([':now' => $now]);
    $statement = $pdo->prepare(
        'INSERT INTO vk_oauth_tickets (ticket_hash, profile, expires_at, created_at)
         VALUES (:ticket_hash, :profile, :expires_at, :created_at)'
    );
    $statement->execute([
        ':ticket_hash' => $hash,
        ':profile' => $profile,
        ':expires_at' => $now + 300,
        ':created_at' => gmdate('c'),
    ]);
    return $ticket;
}

function cc_vk_consume_ticket(string $ticket): ?string
{
    if ($ticket === '') {
        return null;
    }

    $hash = hash('sha256', $ticket);
    $pdo = cc_vk_ensure_schema();
    $statement = $pdo->prepare('SELECT profile, expires_at FROM vk_oauth_tickets WHERE ticket_hash = :ticket_hash LIMIT 1');
    $statement->execute([':ticket_hash' => $hash]);
    $row = $statement->fetch();
    $pdo->prepare('DELETE FROM vk_oauth_tickets WHERE ticket_hash = :ticket_hash')->execute([':ticket_hash' => $hash]);

    if (!is_array($row) || (int)$row['expires_at'] < time()) {
        return null;
    }

    return cc_vk_profile_name((string)$row['profile']);
}
