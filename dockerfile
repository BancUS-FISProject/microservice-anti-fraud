FROM node:18-alpine AS builder

# Establecemos el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos solo los archivos de dependencias primero (para aprovechar el caché de Docker)
COPY package*.json ./

# Instalamos TODAS las dependencias (incluyendo devDependencies para poder compilar)
RUN npm ci

# Copiamos el resto del código fuente
COPY . .

# Compilamos la aplicación (Genera la carpeta /dist)
RUN npm run build

# --- ETAPA 2: PRODUCTION (Ejecución) ---
# Empezamos desde cero con una imagen limpia para que pese poco
FROM node:18-alpine

WORKDIR /app

# Copiamos solo lo necesario desde la etapa 'builder' anterior
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Exponemos el puerto 3000 (informativo)
EXPOSE 3000

# Comando para arrancar la app en modo producción
CMD ["node", "dist/main"]