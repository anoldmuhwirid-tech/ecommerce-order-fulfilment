# E-commerce Order Fulfilment & Inventory API

DIT2324 Web Technologies, Final Assessment (Case Study B).

An Express.js and MySQL backend for an e-commerce store. It manages products and orders, tracks shipments, calls three external Web APIs, and is secured and deployed to the cloud.

**Live site:** https://ecommerce-order-fulfilment-production.up.railway.app
**Health check:** https://ecommerce-order-fulfilment-production.up.railway.app/health

## Features

- **Web API gateway (Task 1):** integrates three external APIs
  - ExchangeRate-API: currency conversion of product prices
  - Zippopotam.us: shipping postcode validation (city and state auto-filled)
  - Telegram Bot API: order notifications to the fulfilment team
- **Database and new feature (Task 2):** MySQL with shipment tracking and an order status audit trail. Full CRUD for products, orders and shipments, with row-locked transactions for orders, status changes and shipments.
- **Security (Task 3):** input validation, parameterised SQL, bcrypt password hashing, JWT in an httpOnly cookie with an admin role check, Helmet headers and rate limiting.
- **Deployment (Task 4):** Git and GitHub, environment variables, and automatic deployment on Railway with a managed MySQL database.

## Tech stack

Node.js , Express , MySQL  , express-validator, bcryptjs, jsonwebtoken, helmet, express-rate-limit, dotenv.

## Project structure


ecommerce-order-fulfilment/
├── public/            front end (HTML, CSS, JS, images)
├── src/
│   ├── db.js          MySQL connection pool (reads environment variables)
│   ├── externalApis.js  currency, postcode and Telegram integrations
│   └── security.js    login cookie, admin check, validation helper
├── server.js          Express app and API routes
├── seed-admin.js      creates the admin user with a hashed password
├── database.sql       schema and sample products
├── .env.example       template of required environment variables
└── package.json
```

## Run locally

1. Install **Node.js  or later** and **MySQL ** (or XAMPP).
2. Install the packages:
   ```
   npm install
   ```
3. Create your environment file:
   ```
   copy .env.example .env
   ```
   Open `.env` and set `JWT_SECRET` (a long random string) and `ADMIN_PASSWORD` (at least 8 characters). Generate a secret with:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
4. Start MySQL, then create the database and tables by importing `database.sql` (phpMyAdmin **Import**, or `mysql -u root -p < database.sql`).
5. Create the admin account:
   ```
   npm run seed:admin
   ```
6. Start the server:
   ```
   npm start
   ```
7. Open http://localhost:3000.

## Environment variables

Set these in `.env` locally, or in the Railway **Variables** tab. Never commit real values.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default 3000) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `DATABASE_URL` | Optional single connection string instead of the `DB_*` values |
| `DB_SSL` | `true` if the database requires SSL |
| `JWT_SECRET` | Secret used to sign login cookies (required) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Used by `npm run seed:admin` |
| `BASE_CURRENCY` | Currency of stored prices (default `MYR`) |
| `DEFAULT_COUNTRY` | Country code for postcode checks (default `MY`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional order notifications |

## API endpoints

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/api/login`, `/api/logout` | Public | Start or end an admin session |
| GET | `/api/products`, `/api/products/:id` | Public | Catalogue. Add `?currency=USD` for a converted price |
| POST, PUT, DELETE | `/api/products[/:id]` | Admin | Product CRUD |
| GET | `/api/rates?amount=&to=` | Public | Exchange rate lookup |
| GET | `/api/postcode/:code` | Public | Postcode validation |
| POST | `/api/orders` | Public | Place an order (transaction, optional shipping details) |
| GET | `/api/orders`, `/api/orders/:id` | Admin | List orders, order detail with items, shipment and history |
| PATCH | `/api/orders/:id/status` | Admin | Change order status (audited, restocks on cancel) |
| DELETE | `/api/orders/:id` | Admin | Delete an order |
| GET, POST, PUT, DELETE | `/api/shipments[/:id]` | Admin | Shipment CRUD |
| GET | `/api/track/:trackingNo` | Public | Look up a parcel by tracking number |
| GET | `/health` | Public | Health check |

## Deployment (Railway)

1. Push this repository to GitHub.
2. In Railway, create a project with **Deploy from GitHub repo** and select this repository.
3. Add a **MySQL** database service to the same project.
4. In the web service **Variables**, add `NODE_ENV`, `PORT`, `JWT_SECRET`, `BASE_CURRENCY`, `DEFAULT_COUNTRY`, and the `DB_*` values as references to the MySQL service.
5. Load the tables into the Railway database and create the admin user.
6. Generate a public domain (port 3000) under **Settings → Networking**.
7. Auto deploy is on, so every push to `main` rebuilds and redeploys the app.

## Notes

The `.env` file is listed in `.gitignore` and must never be committed. Use `.env.example` as the template.
