<?php

// Linear Congruential Generator (LCG) — manual random number generation
// Uses microsecond-precision time components as entropy source

$timeParts = explode(' ', microtime());
$microseconds = (int)(((float)$timeParts[0]) * 1000000);
$seconds = (int)$timeParts[1];
$seed = $microseconds ^ ($seconds * 31);

// LCG parameters (Numerical Recipes constants)
$a = 1664525;
$c = 1013904223;
$m = (1 << 31); // 2^31 to stay within int range

// Run several LCG iterations for better distribution
for ($i = 0; $i < 5; $i++) {
    $seed = ($a * $seed + $c) % $m;
}
$randomNumber = abs($seed);

// Log the generated number to stderr (visible in container/server logs)
$timestamp = date('Y-m-d H:i:s');
error_log("[{$timestamp}] PHP Random Test - Generated number: {$randomNumber}");

header('Content-Type: application/json');
echo json_encode([
    'message' => 'Hello from PHP Random Test!',
    'random_number' => $randomNumber,
    'timestamp' => date('c'),
]);
