# Microservice Anti-Fraud | BancUS

[![NestJS](https://img.shields.io/badge/NestJS-E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)

Este repositorio pertenece a la plataforma bancaria distribuida **BancUS**. El microservicio `microservice-anti-fraud` se encarga de analizar transacciones en tiempo real, identificar posibles fraudes, registrar alertas y bloquear cuentas de manera preventiva.

## Información General

- **Base URL Pública (vía API Gateway):** `http://localhost:10000/v1/antifraud`
- **Base URL Interna (acceso directo en local con Docker):** `http://localhost:8006/v1/antifraud`
- **Documentación OpenAPI / Swagger:** `http://localhost:8006/api` (acceso directo)
- **Docker Image Oficial:** `angelmr01/microservice-antifraud:latest`
- **Persistencia de Datos:** MongoDB con Mongoose (DTOs y esquemas tipados con class-validator).
- **Caché Distribuida:** Redis (gestor de caché para historial de transacciones, TTL de 30 segundos).

Para descargar la imagen oficial:
```bash
docker pull angelmr01/microservice-antifraud:latest
```

---

## Arquitectura y Patrones de Resiliencia

Este microservicio se diseñó para operar en un entorno distribuido complejo donde la resiliencia es crítica, implementando los siguientes patrones:

### 1. Circuit Breaker con Opossum
Para el aislamiento de fallos, implementamos el patrón Circuit Breaker utilizando **Opossum** en las comunicaciones salientes hacia el microservicio de `Accounts` (específicamente durante la ejecución del bloqueo preventivo de cuentas).
- **Funcionamiento:** Si las llamadas al servicio de `Accounts` fallan reiteradamente o exceden el umbral configurado (`ACCOUNTS_BLOCK_TIMEOUT_MS`), el circuito se *abre* (Open State). Esto permite rechazar las peticiones inmediatamente y ejecutar un fallback controlado, evitando consumir recursos innecesarios del microservicio principal o cascadas de fallos en el sistema. Una vez restablecida la salud del servicio de Accounts, el circuito transiciona a *Half-Open* y luego a *Closed*.

### 2. Estrategia de Caché en dos niveles (Redis)
El microservicio analiza el historial transaccional para detectar comportamientos anómalos. Dado que las peticiones directas al microservicio de `Transfers` son costosas en latencia, implementamos una estrategia *Cache-Aside* con Redis:
- **Funcionamiento:** Consultamos el historial en Redis bajo la clave `history:${iban}`. 
- **Cache Miss:** Si no existe, se consulta vía REST al microservicio `Transfers`, guardando la respuesta en Redis con un **TTL de 30 segundos**. *(Nota: El TTL se configuró a 30s para facilitar las pruebas del ciclo de expiración de caché).*
- **Tolerancia a fallos de Redis:** En caso de que el servidor Redis no esté disponible, el servicio captura la excepción y realiza la consulta directamente al servicio `Transfers` para no interrumpir la evaluación.

### 3. Materialized View
Para lograr la menor latencia posible durante la evaluación, mantenemos una **réplica local o vista materializada (Materialized View)** del estado de las cuentas bancarias dentro de este microservicio. 
- **Beneficio:** Nos permite validar la existencia y el estado previo de una cuenta sin incurrir en peticiones HTTP constantes hacia el microservicio de `Accounts`.

### 4. Validación y Seguridad
El tráfico entrante es autenticado mediante tokens **JWT** en el API Gateway. Adicionalmente, se realiza validación en la capa de controladores.
- **DTOs y ValidationPipes:** Se utilizan `class-validator` y `class-transformer` para validar el payload de las peticiones antes de interactuar con MongoDB.

---

## Especificación de Endpoints

### 1. Evaluar Transacción (Risk Check)
Evalúa una transacción en curso. Si detecta riesgo, genera una alerta y dispara un evento de bloqueo preventivo de la cuenta origen comunicándose con el microservicio de `Accounts` mediante Circuit Breaker.

- **URL:** `/v1/antifraud/transaction-check`
- **Method:** `POST`

**Request Body (JSON):**
```json
{
  "origin": "ES9601698899486406184873",
  "destination": "ES3814819892286713210283",
  "amount": 500,
  "transactionDate": "2025-12-26T10:00:00Z"
}
```

**Success Response (200 OK):**
```json
{
  "message": "Fraudulent behaviour detected."
}
```

**Ejemplo cURL (vía API Gateway):**
```bash
curl -X POST http://localhost:10000/v1/antifraud/transaction-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{ "origin": "ES9601698899486406184873", "destination": "ES3814819892286713210283", "amount": 500, "transactionDate": "2025-12-26T10:00:00Z" }'
```

### 2. Obtener Historial de Alertas de Usuario
Recupera el listado completo de alertas de fraude asociadas al IBAN de una cuenta bancaria.

- **URL:** `/v1/antifraud/accounts/:iban/fraud-alerts`
- **Method:** `GET`

**Success Response (200 OK):**
```json
[
  {
    "_id": "64b1f4a1e4b0123456789abc",
    "origin": "ES1234567890123456789012",
    "destination": "ES0987654321098765432109",
    "amount": 5000.50,
    "transactionDate": "2026-09-28T10:00:00.000Z",
    "reason": "Fraud detected: high money amount transferred.",
    "status": "CONFIRMED",
    "reportDate": "2026-09-28T12:44:23.000Z",
    "reportUpdateDate": "2026-09-28T12:44:23.000Z"
  }
]
```

**Ejemplo cURL (vía API Gateway):**
```bash
curl -X GET http://localhost:10000/v1/antifraud/accounts/ES1234567890123456789012/fraud-alerts \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 3. Actualizar Estado de Alerta
Permite al personal autorizado (ej: backend operations) actualizar el estado o motivo de una alerta existente.

- **URL:** `/v1/antifraud/fraud-alerts/:id`
- **Method:** `PUT`

**Request Body (JSON):**
```json
{
  "status": "FALSE_POSITIVE",
  "reason": "Verified with customer by phone call. False positive."
}
```

**Success Response (200 OK):**
```json
{
  "_id": "64b1f4a1e4b0123456789abc",
  "origin": "ES1234567890123456789012",
  "destination": "ES0987654321098765432109",
  "amount": 5000.50,
  "transactionDate": "2026-09-28T10:00:00.000Z",
  "reason": "Verified with customer by phone call. False positive.",
  "status": "FALSE_POSITIVE",
  "reportDate": "2026-09-28T12:44:23.000Z",
  "reportUpdateDate": "2026-09-28T15:00:00.000Z"
}
```

**Ejemplo cURL (vía API Gateway):**
```bash
curl -X PUT http://localhost:10000/v1/antifraud/fraud-alerts/64b1f4a1e4b0123456789abc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{ "status": "FALSE_POSITIVE", "reason": "Verified with customer by phone call. False positive." }'
```

### 4. Eliminar Alerta
Permite eliminar un registro de alerta del sistema (soft delete o hard delete dependiendo de la persistencia configurada).

- **URL:** `/v1/antifraud/fraud-alerts/:id`
- **Method:** `DELETE`

**Success Response (200 OK):**
```json
{
  "message": "Alert deleted successfully",
  "id": "64b1f4a1e4b0123456789abc"
}
```

**Ejemplo cURL (vía API Gateway):**
```bash
curl -X DELETE http://localhost:10000/v1/antifraud/fraud-alerts/64b1f4a1e4b0123456789abc \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 5. Health Check
Endpoint de observabilidad utilizado por orquestadores (Docker Swarm / Kubernetes) o balanceadores de carga para sondas de liveness y readiness.

- **URL:** `/health`
- **Method:** `GET`

**Success Response (200 OK):**
```json
{
  "status": "UP",
  "service": "anti-fraud"
}
```
*(Durante el inicio o si hay dependencias no disponibles, devuelve código `503 Service Unavailable` con detalle del inicio).*

**Ejemplo cURL (Directo, ya que Health no suele exponerse en el Gateway):**
```bash
curl -X GET http://localhost:8006/health
```

---

## Códigos de Respuesta HTTP

El servicio se adhiere estrictamente al estándar REST HTTP:

| HTTP Status Code | Significado | Descripción |
| :--- | :--- | :--- |
| **`200 OK`** | Operación exitosa | Lecturas, actualizaciones y procesamiento de riesgos exitosos. |
| **`201 Created`** | Recurso creado | (Usado si en el futuro se exponen recursos de creación directa). |
| **`204 No Content`** | Eliminación exitosa | Al eliminar una alerta correctamente (dependiendo del controlador). |
| **`400 Bad Request`** | Error de validación | El cuerpo de la petición (JSON) no cumple los esquemas de validación (DTO mismatch). |
| **`401 Unauthorized`** | No autorizado | Falta el token JWT o es inválido/expirado. |
| **`404 Not Found`** | No Encontrado | El ID de alerta o IBAN provisto no existe en la BD. |
| **`503 Service Unavailable`** | Servicio no disponible | Fallo de conexión con MongoDB, apertura forzosa del Circuit Breaker sin fallback exitoso, o servicio iniciándose. |

---

## Configuración y Despliegue

### Variables de Entorno (`.env`)
El servicio requiere la configuración de las siguientes variables para su correcto funcionamiento. Se recomienda el uso de un archivo `.env` en desarrollo.

```env
# Configuración del servidor (puerto interno del contenedor, mapeado al 8006 en el host mediante Docker)
PORT=3000

# Base de datos
MONGO_URI=mongodb://localhost:27017/bancus_anti_fraud

# Caché (Redis)
REDIS_HOST=localhost
REDIS_PORT=6379

# Integración entre microservicios
TRANSFERS_MS_URL=http://localhost:3004
ACCOUNTS_MS_URL=http://localhost:3001

# Tolerancia de Resiliencia
ACCOUNTS_BLOCK_TIMEOUT_MS=3000

# Seguridad Autenticación
JWT_SECRET=super_secret_jwt_key_bancus
```

### Comandos Docker (Docker Compose)
Se proporciona integración mediante `docker-compose.yml` en la raíz de BancUS para orquestar la suite de servicios. Para aislar este microservicio localmente:

Construir y levantar los contenedores:
```bash
docker-compose up --build -d
```
Ver los logs en tiempo real:
```bash
docker-compose logs -f microservice-anti-fraud
```
Detener y destruir los contenedores:
```bash
docker-compose down
```

### Testing (Jest)
El repositorio incluye pruebas unitarias, de integración y End-to-End (E2E) configuradas con Jest y Supertest.

Para ejecutar los tests estándar:
```bash
npm run test
```
Para generar el reporte de cobertura de código:
```bash
npm run test:cov
```
Para ejecutar las pruebas End-to-End (requieren instancias efímeras de Mongo/Redis en memoria si está configurado así):
```bash
npm run test:e2e
```

---
*Documentación generada y mantenida por el equipo de Core Backend Platform - BancUS.*
