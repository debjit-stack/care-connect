# CareConnect - Hospital Management System

![CareConnect Banner](https://placehold.co/1200x300/3B82F6/FFFFFF?text=CareConnect&font=raleway)

**CareConnect** is a modern, full-stack hospital management application designed to streamline hospital operations and enhance the patient experience. Built with the MERN stack, it provides a seamless, role-based platform for admins, doctors, receptionists, and patients.

**Live Frontend:** [ccmanagement.netlify.app](https://ccmanagement.netlify.app/)  
**Live Backend API:** [care-connect-api-1m1s.onrender.com](https://care-connect-api-1m1s.onrender.com/)

---

## ✨ Key Features

The application is divided into a public-facing website and secure, role-based dashboards.

### Patient Features
- **Find Doctors:** Browse a public list of available doctors and view their profiles.
- **Real-time Availability:** View a doctor's real-time available appointment slots for any given day.
- **Self-Service Booking:** Securely book appointments and health packages online.
- **Personal Dashboard:** View a complete history of past appointments, including clinical notes and prescriptions.

### Receptionist Features
- **Offline Booking:** Book appointments and health packages for walk-in or call-in patients.
- **Patient Management:** Register new patients and search for existing ones.
- **Daily Schedule View:** View all appointments for any given day to manage patient flow.

### Doctor Features
- **Clinical Workspace:** A dedicated dashboard to view and manage assigned appointments.
- **Patient History Access:** Securely access a patient's complete medical history before a consultation.
- **Update Records:** Add clinical notes and prescriptions after a consultation.
- **Schedule Management:** Manage their own weekly work availability.

### Admin Features
- **Command Center Dashboard:** A comprehensive dashboard with KPI cards and management tools.
- **Full CRUD Control:** Create, read, update, and delete all users (patients, doctors, receptionists).
- **Password Resets:** Securely reset any user's password.
- **Service Management:** Full CRUD control over health packages.

---

## 🛠️ Technology Stack

- **Frontend:** React, Vite, React Router, Axios, Tailwind CSS
- **Backend:** Node.js, Express.js
- **Database:** MongoDB Atlas
- **Authentication:** JSON Web Tokens (JWT)

---

## 🚀 Getting Started

To run this project locally, you will need to start both the backend server and the frontend client.

### Prerequisites
- Node.js installed
- npm or yarn installed
- A MongoDB Atlas account

### 1. Backend Setup (`/server`)

1.  Navigate to the `server` directory:
    ```bash
    cd server
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the `server` directory and add your environment variables:
    ```env
    MONGO_URI=YOUR_MONGODB_ATLAS_CONNECTION_STRING
    JWT_SECRET=YOUR_SUPER_SECRET_JWT_KEY
    PORT=5000
    ```
4.  Start the server:
    ```bash
    npm run dev
    ```
    The backend will be running at `http://localhost:5000`.

### 2. Frontend Setup (`/client`)

1.  Open a new terminal and navigate to the `client` directory:
    ```bash
    cd client
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the client:
    ```bash
    npm run dev
    ```
    The frontend will open in your browser at `http://localhost:3000`.

---

## 🚢 Deployment

This application is deployed as two separate services:

- The **backend** is deployed as a Web Service on **Render**.
- The **frontend** is deployed as a static site on **Netlify**.

The live frontend is configured via environment variables to communicate with the live backend API.
