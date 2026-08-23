<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

cc_require_auth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST, OPTIONS');
    cc_error('Method not allowed.', 405);
}

function cc_transcript_http(string $url, string $method = 'GET', ?string $body = null, array $headers = [], int $timeout = 45): array
{
    $defaultHeaders = [
        'Accept: */*',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept-Language: en-US,en;q=0.9,ru;q=0.8',
    ];
    $headers = array_merge($defaultHeaders, $headers);

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('Could not initialize cURL.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
        ]);
        if ($method !== 'GET') {
            curl_setopt($curl, CURLOPT_CUSTOMREQUEST, $method);
            if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        $result = curl_exec($curl);
        if ($result === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new RuntimeException('HTTP request failed: ' . $error);
        }
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return [$status, (string)$result];
    }

    if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        throw new RuntimeException('Hosting needs PHP cURL or allow_url_fopen.');
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers) . "\r\n",
            'content' => $body ?? '',
            'timeout' => $timeout,
            'ignore_errors' => true,
        ],
    ]);
    $result = file_get_contents($url, false, $context);
    if ($result === false) {
        throw new RuntimeException('HTTP request failed through PHP stream transport.');
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
    return [$status, (string)$result];
}

function cc_youtube_video_id(array $body): string
{
    $id = trim((string)($body['videoId'] ?? ''));
    if ($id === '' && !empty($body['url'])) {
        $url = (string)$body['url'];
        $parts = parse_url($url);
        $host = strtolower((string)($parts['host'] ?? ''));
        $path = trim((string)($parts['path'] ?? ''), '/');
        if ($host === 'youtu.be' || $host === 'www.youtu.be') {
            $id = explode('/', $path)[0] ?? '';
        } elseif (str_ends_with($host, 'youtube.com')) {
            parse_str((string)($parts['query'] ?? ''), $query);
            $id = (string)($query['v'] ?? '');
            if ($id === '' && preg_match('#^(?:shorts|embed|live)/([^/]+)#', $path, $match)) {
                $id = $match[1];
            }
        }
    }
    if (!preg_match('/^[A-Za-z0-9_-]{6,20}$/', $id)) {
        cc_error('Invalid YouTube video id.', 422);
    }
    return $id;
}

function cc_caption_tracks(string $html): array
{
    if (!preg_match('/"captionTracks":(\[.*?\])(?:,"audioTracks"|,"translationLanguages"|})/s', $html, $match)) {
        if (!preg_match('/"captionTracks":(\[.*?\])/s', $html, $match)) return [];
    }
    $tracks = json_decode($match[1], true);
    return is_array($tracks) ? $tracks : [];
}

function cc_choose_caption_track(array $tracks, array $preferred): ?array
{
    if (!$tracks) return null;
    $preferred = array_values(array_filter(array_map(fn($value) => strtolower(trim((string)$value)), $preferred)));

    foreach ($preferred as $language) {
        foreach ($tracks as $track) {
            $code = strtolower((string)($track['languageCode'] ?? ''));
            if ($code === $language && ($track['kind'] ?? '') !== 'asr') return $track;
        }
        foreach ($tracks as $track) {
            $code = strtolower((string)($track['languageCode'] ?? ''));
            if ($code === $language || str_starts_with($code, $language . '-')) return $track;
        }
    }

    foreach ($tracks as $track) {
        if (($track['kind'] ?? '') !== 'asr') return $track;
    }
    return $tracks[0] ?? null;
}

function cc_decode_json3(string $raw): array
{
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['events']) || !is_array($data['events'])) return [];
    $segments = [];
    foreach ($data['events'] as $event) {
        if (!isset($event['segs']) || !is_array($event['segs'])) continue;
        $text = '';
        foreach ($event['segs'] as $piece) $text .= (string)($piece['utf8'] ?? '');
        $text = trim(preg_replace('/\s+/u', ' ', html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
        if ($text === '') continue;
        $segments[] = [
            'start' => round(((float)($event['tStartMs'] ?? 0)) / 1000, 3),
            'duration' => round(((float)($event['dDurationMs'] ?? 0)) / 1000, 3),
            'text' => $text,
        ];
    }
    return $segments;
}

function cc_whisper_fallback(string $videoUrl, array $preferred): array
{
    $config = cc_config();
    $service = rtrim(trim((string)($config['whisper_service_url'] ?? '')), '/');
    if ($service === '') {
        cc_error('This video has no YouTube captions. Whisper fallback is not configured on the backend yet.', 422, [
            'code' => 'whisper_not_configured',
        ]);
    }

    $payload = json_encode([
        'url' => $videoUrl,
        'language' => $preferred[0] ?? null,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($payload === false) throw new RuntimeException('Could not encode Whisper request.');

    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    $token = trim((string)($config['whisper_service_token'] ?? ''));
    if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;

    [$status, $raw] = cc_transcript_http($service . '/transcribe', 'POST', $payload, $headers, 1800);
    $data = json_decode($raw, true);
    if ($status >= 400 || !is_array($data) || empty($data['ok'])) {
        $message = is_array($data) ? (string)($data['error'] ?? $data['detail'] ?? '') : '';
        throw new RuntimeException('Whisper service failed' . ($message !== '' ? ': ' . $message : '.'));
    }
    return $data;
}

$body = cc_read_json_body();
$videoId = cc_youtube_video_id($body);
$preferred = $body['preferredLanguages'] ?? ['ru', 'en'];
if (!is_array($preferred)) $preferred = ['ru', 'en'];
$watchUrl = 'https://www.youtube.com/watch?v=' . rawurlencode($videoId);

try {
    [$status, $html] = cc_transcript_http($watchUrl . '&hl=en');
    if ($status >= 400 || $html === '') throw new RuntimeException('Could not load YouTube video page.');

    $tracks = cc_caption_tracks($html);
    $track = cc_choose_caption_track($tracks, $preferred);

    if (!$track || empty($track['baseUrl'])) {
        $fallback = cc_whisper_fallback($watchUrl, $preferred);
        cc_json([
            'ok' => true,
            'method' => 'whisper',
            'language' => $fallback['language'] ?? '',
            'generated' => true,
            'text' => (string)($fallback['text'] ?? ''),
            'segments' => is_array($fallback['segments'] ?? null) ? $fallback['segments'] : [],
        ]);
    }

    $captionUrl = (string)$track['baseUrl'];
    $captionUrl .= (str_contains($captionUrl, '?') ? '&' : '?') . 'fmt=json3';
    [$captionStatus, $captionRaw] = cc_transcript_http($captionUrl, 'GET', null, ['Accept: application/json']);
    if ($captionStatus >= 400) throw new RuntimeException('YouTube captions request failed.');

    $segments = cc_decode_json3($captionRaw);
    if (!$segments) throw new RuntimeException('YouTube returned an empty or unsupported caption track.');
    $text = implode("\n", array_map(fn($segment) => $segment['text'], $segments));

    cc_json([
        'ok' => true,
        'method' => 'captions',
        'language' => (string)($track['languageCode'] ?? ''),
        'generated' => (($track['kind'] ?? '') === 'asr'),
        'trackName' => (string)($track['name']['simpleText'] ?? ''),
        'text' => $text,
        'segments' => $segments,
    ]);
} catch (Throwable $e) {
    cc_error('Transcript error: ' . $e->getMessage(), 502);
}
