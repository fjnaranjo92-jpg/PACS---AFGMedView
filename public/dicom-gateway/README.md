# AFGMedView DICOM Gateway

Gateway DICOM para recibir estudios desde RadiAnt u otras modalidades DICOM.

## Requisitos

- Node.js 18 o superior
- Puerto 4242 disponible (configurable)
- Acceso de red desde RadiAnt al servidor donde corre este gateway

## Instalación

```bash
# 1. Copiar estos archivos a su servidor
# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con sus valores
```

## Variables de entorno (.env)

```env
DICOM_AE_TITLE=AFGMEDVIEW
DICOM_PORT=4242
CONVEX_SITE_URL=https://notable-husky-337.convex.site
DICOM_INBOX_DIR=./dicom-inbox
```

## Ejecutar

```bash
node gateway.js
```

## Configuración en RadiAnt

| Campo       | Valor                          |
|-------------|-------------------------------|
| Description | AFGMedView                    |
| AE Title    | AFGMEDVIEW                    |
| IP Address  | IP de este servidor/PC        |
| Port        | 4242                          |

## Estructura de archivos DICOM recibidos

```
dicom-inbox/
  {StudyInstanceUID}/
    {SeriesInstanceUID}/
      {SOPInstanceUID}.dcm
```
