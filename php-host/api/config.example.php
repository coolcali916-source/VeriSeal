<?php
// Copy to config.php on your hosting server if connecting to a provisioned MySQL database.
// Leave DB_DRIVER as 'auto' to use MySQL when configured/reachable or local SQLite otherwise.
return [
  'DB_DRIVER' => 'auto', // 'auto' | 'mysql' | 'sqlite'
  'MYSQL_HOST' => 'sql309.iceiy.com',
  'MYSQL_PORT' => 3306,
  'MYSQL_USER' => 'icei_43474941',
  'MYSQL_PASS' => '',
  'MYSQL_DB' => '', // e.g. icei_43474941_veriseal once created in VistaPanel
];
