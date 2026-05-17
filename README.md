<<<<<<< HEAD
# LexGuard MX — Guía de Despliegue

## Estructura del proyecto

```
lexguard-project/
├── api/
│   └── chat.js          ← Backend seguro (Vercel Function)
├── src/
│   ├── main.jsx
│   └── App.jsx          ← App principal
├── public/              ← Pon aquí los íconos de la app
├── index.html
├── package.json
├── vite.config.js       ← Config PWA incluida
└── vercel.json
```

---

## PASO 1 — Subir a GitHub (desde celular)

1. Entra a **github.com** → crea cuenta si no tienes
2. Toca **"+"** → **New repository** → nombre: `lexguard-mx` → Create
3. Toca **"uploading an existing file"**
4. Sube todos los archivos de este proyecto manteniendo la estructura de carpetas
5. Commit: "Initial commit"

---

## PASO 2 — Desplegar en Vercel (gratis)

1. Entra a **vercel.com** → Sign up con tu cuenta de GitHub
2. Toca **"Add New Project"**
3. Importa el repo `lexguard-mx`
4. En **"Environment Variables"** agrega:

   | Variable | Valor |
   |----------|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` (tu key de Anthropic) |
   | `ALLOWED_ORIGIN` | `https://lexguard-mx.vercel.app` (tu dominio) |

5. Toca **Deploy** ✅

Tu app estará en: `https://lexguard-mx.vercel.app`

---

## PASO 3 — Instalar como PWA (como si fuera app de Play Store)

### En Android (Chrome):
1. Abre tu URL de Vercel en Chrome
2. Aparece un banner "Agregar a pantalla de inicio" → tócalo
3. O toca el menú (⋮) → "Instalar app"

### En iOS (Safari):
1. Abre la URL en Safari
2. Toca el botón compartir (□↑)
3. "Agregar a pantalla de inicio"

Los usuarios pueden hacer lo mismo — la app se instala como nativa, funciona offline y tiene ícono propio.

---

## PASO 4 — Publicar en Google Play (opcional, más avanzado)

Para publicar como APK real en Google Play necesitas Capacitor:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init LexGuard com.lexguard.mx
npm run build
npx cap add android
npx cap sync
npx cap open android
```

Luego desde Android Studio → Build → Generate Signed Bundle/APK.
Costo de cuenta de desarrollador Google Play: **$25 USD una sola vez**.

---

## API Key de Anthropic

Obtén la tuya en: **console.anthropic.com** → API Keys → Create Key

⚠️ Nunca compartas ni expongas tu API key en el código del frontend.
El archivo `api/chat.js` la mantiene segura en el servidor.
=======
# lexguard-mx
LexGuard MX — App gratuita de auxilio ciudadano para México. Botón SOS que notifica a tus contactos con tu ubicación GPS, llamada directa al 911 y asistente de IA entrenado en la Constitución Mexicana para guiarte durante una detención policial. React + Vite + Anthropic API.
>>>>>>> 10e3701c1dc9cb614689ea8cf87149b87f41218e
