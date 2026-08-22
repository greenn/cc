<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

cc_require_auth();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$profile = cc_profile();

try {
    $db = cc_db();

    if ($method === 'GET') {
        $stmt = $db->prepare('SELECT payload, revision, created_at, updated_at FROM app_state WHERE profile = :profile');
        $stmt->execute(['profile' => $profile]);
        $row = $stmt->fetch();

        if (!$row) {
            cc_json([
                'ok' => true,
                'profile' => $profile,
                'revision' => 0,
                'updatedAt' => null,
                'state' => null,
            ]);
        }

        $state = json_decode($row['payload'], true);
        cc_json([
            'ok' => true,
            'profile' => $profile,
            'revision' => (int)$row['revision'],
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
            'state' => $state,
        ]);
    }

    if ($method === 'POST' || $method === 'PUT') {
        $body = cc_read_json_body();
        $state = array_key_exists('state', $body) ? $body['state'] : $body;

        if (!is_array($state)) {
            cc_error('state must be a JSON object.', 422);
        }

        $state = cc_sanitize_state($state);
        $payload = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $now = gmdate('c');

        $db->beginTransaction();
        $select = $db->prepare('SELECT revision, created_at FROM app_state WHERE profile = :profile');
        $select->execute(['profile' => $profile]);
        $existing = $select->fetch();

        if ($existing) {
            $revision = (int)$existing['revision'] + 1;
            $stmt = $db->prepare(
                'UPDATE app_state
                 SET payload = :payload, revision = :revision, updated_at = :updated_at
                 WHERE profile = :profile'
            );
            $stmt->execute([
                'payload' => $payload,
                'revision' => $revision,
                'updated_at' => $now,
                'profile' => $profile,
            ]);
            $createdAt = $existing['created_at'];
        } else {
            $revision = 1;
            $createdAt = $now;
            $stmt = $db->prepare(
                'INSERT INTO app_state (profile, payload, revision, created_at, updated_at)
                 VALUES (:profile, :payload, :revision, :created_at, :updated_at)'
            );
            $stmt->execute([
                'profile' => $profile,
                'payload' => $payload,
                'revision' => $revision,
                'created_at' => $createdAt,
                'updated_at' => $now,
            ]);
        }

        $db->commit();

        cc_json([
            'ok' => true,
            'profile' => $profile,
            'revision' => $revision,
            'createdAt' => $createdAt,
            'updatedAt' => $now,
            'bytes' => strlen($payload),
        ]);
    }

    if ($method === 'DELETE') {
        $stmt = $db->prepare('DELETE FROM app_state WHERE profile = :profile');
        $stmt->execute(['profile' => $profile]);
        cc_json([
            'ok' => true,
            'profile' => $profile,
            'deleted' => $stmt->rowCount() > 0,
        ]);
    }

    header('Allow: GET, POST, PUT, DELETE, OPTIONS');
    cc_error('Method not allowed.', 405);
} catch (Throwable $e) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }
    cc_error('Storage error: ' . $e->getMessage(), 500);
}
