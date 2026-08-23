<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/vk-oauth.php';

cc_require_auth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET, OPTIONS');
    cc_error('Method not allowed.', 405);
}

try {
    $profile = cc_vk_profile_name((string)($_GET['profile'] ?? cc_config()['default_profile'] ?? 'default'));
    cc_json(['ok' => true] + cc_vk_status($profile));
} catch (Throwable $e) {
    cc_error('Could not read VK status: ' . $e->getMessage(), 500);
}
