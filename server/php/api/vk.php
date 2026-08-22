<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

cc_require_auth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST, OPTIONS');
    cc_error('Method not allowed.', 405);
}

$body = cc_read_json_body();
$method = trim((string)($body['method'] ?? ''));
$accessToken = trim((string)($body['accessToken'] ?? ''));
$params = $body['params'] ?? [];

$allowedMethods = ['video.get', 'video.getComments'];
if (!in_array($method, $allowedMethods, true)) {
    cc_error('VK method is not allowed by this proxy.', 403);
}

if ($accessToken === '') {
    cc_error('VK user access token is required.', 422);
}

if (!is_array($params)) {
    cc_error('params must be a JSON object.', 422);
}

$params['access_token'] = $accessToken;
$params['v'] = '5.199';
$postBody = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
$url = 'https://api.vk.com/method/' . rawurlencode($method);

try {
    $raw = null;
    $status = 0;

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('Could not initialize cURL.');
        }

        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $postBody,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
                'Accept: application/json',
            ],
        ]);

        $result = curl_exec($curl);
        if ($result === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new RuntimeException('VK request failed: ' . $error);
        }

        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        $raw = $result;
    } elseif (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json\r\n",
                'content' => $postBody,
                'timeout' => 30,
                'ignore_errors' => true,
            ],
        ]);
        $result = file_get_contents($url, false, $context);
        if ($result === false) {
            throw new RuntimeException('VK request failed through PHP stream transport.');
        }
        $raw = $result;
        $status = 200;
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $line) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
                    $status = (int)$match[1];
                    break;
                }
            }
        }
    } else {
        throw new RuntimeException('Hosting needs either PHP cURL or allow_url_fopen for VK proxy requests.');
    }

    $data = json_decode((string)$raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status >= 400) {
        cc_error('VK HTTP request failed.', 502, ['vkStatus' => $status]);
    }
    if (isset($data['error'])) {
        $vkError = $data['error'];
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
