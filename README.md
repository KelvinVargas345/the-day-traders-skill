# The Day Traders Skill — datos reales

Terminal web estatica con datos reales de mercado y nueve agentes con tareas concretas. No tiene backend, no ejecuta ordenes y no es asesoria financiera.

## Que hace

- **Dashboard:** precio de BTC, volumen 24h del universo, activos en positivo y el indice de Miedo y Codicia, con grafico real de BTC (velas 4h, 7 dias).
- **Market scanner:** 9 activos (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK) filtrados por volumen 24h, con rango 24h, RSI y tendencia frente a la EMA20.
- **Senales:** solo son CONFIRMADA con 4/4 condiciones objetivas: precio sobre EMA20, RSI 40-70, MACD sobre su senal y volumen sobre la mediana del universo.
- **Agentes:**
  1. Crypto Scanner: filtra por volumen real y ordena por volumen.
  2. News Hunter: detecta los movimientos 24h mas fuertes como catalizadores. No inventa titulares.
  3. Technical Analyst: RSI, EMA20, MACD y ATR con velas 4h de 7 dias.
  4. Market Sentiment: Miedo y Codicia, peso de BTC y porcentaje de activos en positivo.
  5. Quant Analyst: retorno, volatilidad, caida maxima y un cruce EMA20 descriptivo.
  6. Entry Sniper: lista de verificacion de 4 condiciones por activo.
  7. Risk Guardian: tamano de posicion segun capital demo, riesgo y ATR (stop 1.5 x ATR).
  8. Exit Strategist: stop, objetivo 1R y 2R, e invalidacion bajo la EMA20.
  9. Trade Auditor: sigue cada senal generada (puntaje >= 70) contra su precio actual, solo en el navegador del usuario.
- **Riesgo y performance:** tabla de stops y objetivos, y estadisticas de las velas reales.
- **Configuracion local:** capital demo y riesgo por operacion. Se guardan solo en el navegador.

## Fuentes de datos (publicas, sin clave)

- CoinGecko: `coins/markets` y `coins/{id}/ohlc` (sin clave, con limite gratuito; si responde 429, la app muestra el error y no inventa datos).
- Alternative.me: indice de Miedo y Codicia.

## Titulares de noticias

CryptoCompare exige una clave para su endpoint de noticias (verificado: sin clave responde 401 y sin datos). Por eso la app no muestra titulares inventados. Si el usuario tiene una clave, puede escribirla en Configuracion: queda solo en el `localStorage` de su navegador, nunca se sube al repositorio ni se envia a otro servidor que no sea CryptoCompare.

## Publicar en GitHub Pages

Es un sitio estatico, sin comando de build:

1. Sube `index.html`, `styles.css` y `app.js` a la raiz del repositorio.
2. En GitHub, Settings → Pages → Deploy from a branch → rama `main` → carpeta `/ (root)`.
3. La URL queda como `https://<usuario>.github.io/the-day-traders-skill/`.

Para desarrollo local, abre `index.html` con un servidor local (por ejemplo, la extension Live Server de VS Code) para evitar restricciones de `file://` con Chart.js.

## Seguridad

- No hay claves, tokens ni credenciales en este repositorio.
- No se piden claves de exchange con permisos de trading o retiros.
- Si en una etapa futura se conecta una cuenta real, debe ser con API de solo lectura y secretos solo en backend, nunca en una pagina estatica.
- Las senales son reglas transparentes calculadas en pantalla, no recomendaciones.
