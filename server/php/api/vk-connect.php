<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/vk-oauth.php';

cc_require_auth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST, OPTIONS');
    cc_error('Method not allowed.', 405);
}

$body = cc_read_json_body();

try {
    $profile = cc_vk_profile_name((string)($body['profile'] ?? cc_config()['default_profile'] ?? 'default'));
    $ticket = cc_vk_create_ticket($profile);
    $redirectUri = trim((string)(cc_config()['vk_redirect_uri'] ?? ''));
    if ($redirectUri === '') {
        throw new RuntimeException('vk_redirect_uri is not configured.');
    }

    $connectUrl = $redirectUri . '?action=start&ticket=' . rawurlencode($ticket);
    cc_json([
        'ok' => true,
        'profile' => $profile,
        'connectUrl' => $connectUrl,
        'expiresIn' => 300,
    ]);
} catch (Throwable $e) {
    cc_error('Could not start VK connection: ' . $e->getMessage(), 500);
}
