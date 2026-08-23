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
$method = trim((string)($body['method'] ?? ''));
$params = $body['params'] ?? [];
$profile = (string)($body['profile'] ?? cc_config()['default_profile'] ?? 'default');

$allowedMethods = ['video.get', 'video.getComments'];
if (!in_array($method, $allowedMethods, true)) {
    cc_error('VK method is not allowed by this proxy.', 403);
}

if (!is_array($params)) {
    cc_error('params must be a JSON object.', 422);
}

try {
    $profile = cc_vk_profile_name($profile);
    $accessToken = cc_vk_refresh_access_token($profile);
    $params['access_token'] = $accessToken;
    $params['v'] = '5.199';

    [$status, $raw] = cc_vk_http_post(
        'https://api.vk.ru/method/' . rawurlencode($method),
        $params
    );

    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status >= 400) {
        cc_error('VK HTTP request failed.', 502, ['vkStatus' => $status]);
    }

    if (isset($data['error'])) {
        $vkError = $data['error'];
        $errorCode = (int)($vkError['error_code'] ?? 0);

        // If VK invalidates the access token slightly before our local expiry,
        // refresh once immediately and retry the read request.
        if (in_array($errorCode, [5, 27, 28], true)) {
            $accessToken = cc_vk_refresh_access_token($profile, true);
            $params['access_token'] = $accessToken;
            [$retryStatus, $retryRaw] = cc_vk_http_post(
                'https://api.vk.ru/method/' . rawurlencode($method),
                $params
            );
            $retryData = json_decode($retryRaw, true, 512, JSON_THROW_ON_ERROR);
            if ($retryStatus < 400 && !isset($retryData['error'])) {
                cc_json([
                    'ok' => true,
                    'response' => $retryData['response'] ?? null,
                ]);
            }
            if (isset($retryData['error'])) {
                $vkError = $retryData['error'];
            }
        }

        cc_error('VK API: ' . (string)($vkError['error_msg'] ?? 'Unknown VK API error'), 502, [
            'vkErrorCode' => $vkError['error_code'] ?? null,
        ]);
    }

    cc_json([
        'ok' => true,
        'response' => $data['response'] ?? null,
    ]);
} catch (Throwable $e) {
    cc_error('VK proxy error: ' . $e->getMessage(), 502);
}
