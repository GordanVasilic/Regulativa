UPDATE laws 
SET path_pdf = REPLACE(REPLACE(path_pdf, 'D:\Projekti\Regulativa\Dokumenti\', '/var/www/regulativa/Dokumenti/'), '\', '/');
