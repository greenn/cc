<?php

declare(strict_types=1);

return [
    // Prefer setting this outside the public web root when your hosting allows it.
    // Example: /home/USER/private/cc.sqlite
    'db_path' => __DIR__ . '/data/cc.sqlite',

    // Generate a long random token and keep it only on the server and in your local CC settings.
    // Do not commit the real token to GitHub.
    'api_token' => 'CHANGE-ME-TO-A-LONG-RANDOM-TOKEN',

    // Exact browser origins allowed to call the API.
    'allowed_origins' => [
        'https://greenn.github.io',
        'https://cdn.nadube.ru',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
    ],

    // Maximum JSON request body size. Current CC state is small; 20 MB leaves room to grow.
    'max_body_bytes' => 20 * 1024 * 1024,

    // Used by the state endpoint when no profile is supplied.
    'default_profile' => 'default',
];
