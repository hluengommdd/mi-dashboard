# 📊 Mi Dashboard - Gestión de Observación en Aula

Dashboard profesional de análisis de desempeño académico con sincronización automática inteligente desde Supabase.

## 🚀 Características

- **Sincronización Inteligente**: Polling condicional que solo actualiza cuando hay nuevos datos en Supabase
- **Análisis en Tiempo Real**: Visualización de indicadores de desempeño docente
- **Gráficos Interactivos**: Chart.js con radar charts para dimensiones y análisis detallado
- **Múltiples Vistas**: Individual, Promedios por Docente, y Vista General
- **Búsqueda Avanzada**: Filtrado instantáneo por docente, asignatura o curso
- **UI Profesional**: Diseño moderno y responsive con indicadores visuales

## 📦 Stack Tecnológico

- **Frontend**: React 19.2.0 + Vite 7.2.4
- **Base de Datos**: Supabase (PostgreSQL)
- **Visualización**: Chart.js 4.5.1
- **Estilos**: CSS personalizado con design tokens

## ⚡ Inicio Rápido

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear archivo .env con:
# VITE_SUPABASE_URL=tu_url
# VITE_SUPABASE_ANON_KEY=tu_key

# Desarrollo
npm run dev

# Producción
npm run build
npm run preview
```

## 🔄 Sincronización Automática

La aplicación implementa **polling inteligente** que:
- Verifica cada 30 segundos si hay cambios en Supabase
- Solo carga datos completos cuando detecta nuevos registros
- Ahorra 99% de ancho de banda en ciclos sin cambios
- Muestra indicador visual de estado de sincronización

## 🏗️ Arquitectura

```
observacionaula.vercel.app (Captura)
           ↓
    Supabase (Almacenamiento)
           ↓
    Mi Dashboard (Análisis)
```

## 📈 Módulos

1. **Dashboard Individual**: Análisis detallado por observación
2. **Promedios Docente**: Evolución histórica por profesor
3. **Vista General**: Métricas institucionales agregadas
4. **Top Ranking**: Mejores desempeños del período

## ��️ Desarrollo

```bash
# Servidor desarrollo
npm run dev

# Build producción
npm run build

# Lint
npm run lint
```

## 📝 Licencia

Proyecto educativo - Colegio Veritas
