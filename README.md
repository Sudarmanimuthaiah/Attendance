# Attendance Hub (MySQL & Node.js Server Upgrade)

This repository contains the upgraded **Attendance Hub** portal. The application has been transitioned from browser-based `localStorage` to a secure, real-world **Node.js + Express** backend backed by a **MySQL** database.

---

## 🚀 Key Features of the Upgraded System
1. **Real MySQL Database:** All employees and attendance records are stored permanently in MySQL.
2. **Secure Passwords:** All login sessions are authenticated using secure hashed passwords (via `bcryptjs` and `jsonwebtoken` JWT).
3. **Seeded Admin Account:** Out of the box, the server seeds a default admin account.
4. **Environment Variables:** Configuration is handled dynamically via a `.env` file (supporting local configurations and unified cloud database URLs).
5. **Unified Static Serving:** The Express server automatically serves the frontend app, making it extremely easy to host.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
*   **Node.js** (v18 or higher recommended)
*   **MySQL Server** (local installation, e.g., XAMPP, MySQL Installer, Docker)

### 2. Configure MySQL Database
Create a database in your local MySQL instance. You can do this via phpMyAdmin, MySQL Workbench, or the command line:
```sql
CREATE DATABASE attendance_hub;
```
*(The server will automatically generate the required tables `employees` and `attendance_logs` and seed the administrator account when it starts!)*

If you prefer to import the database structure manually, use the schema file located in:
📂 [server/schema.sql](file:///C:/Users/Arun/IdeaProjects/Attendance/server/schema.sql)

### 3. Setup Environment variables
Go to the server directory:
📂 [server/.env](file:///C:/Users/Arun/IdeaProjects/Attendance/server/.env)

Configure your local database credentials:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password_here
DB_NAME=attendance_hub
DB_PORT=3306
JWT_SECRET=supersecretjwtkey123_attendancehub
```
*(Keep `DB_PASSWORD` blank if you do not have a root password set on your local MySQL server).*

### 4. Install Dependencies & Start the Server
From your terminal, run:
```bash
cd server
npm install
npm run dev
```
Open your browser and navigate to:
👉 **`http://localhost:5000`**

---

## 🔑 Default Sign In Credentials
On database initialization, the system automatically creates the following Admin account:

*   **Role:** HR Administrator / Manager
*   **Employee ID:** `EMP-000`
*   **Default Password:** `adminpassword`

Once logged in as Admin, you can add new employees and assign them custom IDs, designations, emails, and their passwords from the **Employee Directory** tab.

---

## ☁️ Hosting & Production Deployment Guide

Since the server serves both the frontend web app and the database API, you only need to host the **Node.js server** and a **MySQL instance**.

Here are the easiest hosting choices:

### Option A: Railway.app (Recommended - Fastest)
Railway is ideal because you can spin up a Node.js server and a MySQL database in the same dashboard under one project.

1. Create a free account on [Railway.app](https://railway.app/).
2. Click **New Project** -> **Provision MySQL**. This starts a cloud MySQL database.
3. Once initialized, click **New** -> **GitHub Repo** and choose your repository.
4. Under the settings of your newly deployed Node.js service:
   * Set the **Build Command** to: `npm install` (under your server subfolder).
   * Set **Start Command** to: `node server/server.js` (or move package.json files to the root, but pointing the root to the subfolder is fully supported by Railway's directory settings).
5. In the **Variables** tab of your Node service, click **Add Variable** and reference the database:
   * Key: `DATABASE_URL` -> Value: `${{MySQL.DATABASE_URL}}` (Railway automatically links the database connection string!).
   * Key: `JWT_SECRET` -> Value: `your_own_custom_random_secret_string`
6. Railway will automatically build and assign a public `https` URL to access your app from anywhere!

### Option B: Render.com (Free Tier)
Render offers a free tier for hosting Web Services.

1. Create a MySQL database using a free provider (e.g., [Aiven.io](https://aiven.io/), [Clever Cloud](https://www.clever-cloud.com/), or Render's PostgreSQL if you choose to adapt databases).
2. Create an account on [Render.com](https://render.com/).
3. Click **New +** -> **Web Service** and link your GitHub repository.
4. Setup parameters:
   * **Root Directory:** `server`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
5. Click **Advanced** and add the following Environment Variables:
   * `DATABASE_URL` = `mysql://user:password@host:port/database` (your cloud database connection string)
   * `JWT_SECRET` = `your_own_custom_secret`
6. Click **Deploy Web Service**. Render will spin up your application and host it publicly.

---

## 📂 Upgraded File Structure
*   📁 [server/](file:///C:/Users/Arun/IdeaProjects/Attendance/server) - Backend Express code
    *   📄 [server.js](file:///C:/Users/Arun/IdeaProjects/Attendance/server/server.js) - Router APIs, Auth checkpoints, stats aggregators
    *   📄 [db.js](file:///C:/Users/Arun/IdeaProjects/Attendance/server/db.js) - Connection pool & migration/seeding script
    *   📄 [schema.sql](file:///C:/Users/Arun/IdeaProjects/Attendance/server/schema.sql) - Reference SQL tables script
    *   📄 [package.json](file:///C:/Users/Arun/IdeaProjects/Attendance/server/package.json) - Node libraries declarations
    *   📄 [.env](file:///C:/Users/Arun/IdeaProjects/Attendance/server/.env) - Local credentials
*   📄 [index.html](file:///C:/Users/Arun/IdeaProjects/Attendance/index.html) - Unified login interface
*   📄 [app.js](file:///C:/Users/Arun/IdeaProjects/Attendance/app.js) - UI data fetches via client endpoints
