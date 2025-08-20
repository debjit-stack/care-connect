// =================================================================
// >> G-ll: client/src/pages/HomePage.js
// UPDATED - To be a full commercial landing page.
// =================================================================
import React from 'react';
import { Link } from 'react-router-dom';

// Simple icon components for visual flair
const Icon = ({ d, className = "w-6 h-6" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
);

const HomePage = () => {
  return (
    <div>
      {/* Hero Section */}
      <section className="bg-blue-50 py-20 rounded-lg">
        <div className="container mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">
            Compassionate Care, Advanced Medicine
          </h1>
          <p className="text-gray-600 text-lg mb-8 max-w-2xl mx-auto">
            Your trusted partner in health and wellness. Book appointments with our expert specialists online with ease.
          </p>
          <Link 
            to="/doctors" 
            className="bg-blue-600 text-white font-bold py-3 px-8 rounded-full text-lg hover:bg-blue-700 transition-colors shadow-lg"
          >
            Book an Appointment
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div className="p-6">
              <div className="bg-blue-100 text-blue-600 rounded-full p-4 inline-block mb-4">
                <Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Easy Online Booking</h3>
              <p className="text-gray-600">
                Find a doctor and book your slot in minutes from the comfort of your home.
              </p>
            </div>
            <div className="p-6">
              <div className="bg-green-100 text-green-600 rounded-full p-4 inline-block mb-4">
                <Icon d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7.014A8.003 8.003 0 0112 3c1.398 0 2.743.57 3.657 1.514C18.5 6.5 19 9 19 11c2 1 2.657 1.657 2.657 1.657a8 8 0 01-4.001 6.001z" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Specialist Doctors</h3>
              <p className="text-gray-600">
                Access a wide range of highly qualified and experienced medical professionals.
              </p>
            </div>
            <div className="p-6">
              <div className="bg-purple-100 text-purple-600 rounded-full p-4 inline-block mb-4">
                <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Your Health Records</h3>
              <p className="text-gray-600">
                Securely access your prescriptions and health reports anytime through your personal dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action for Health Packages */}
      <section className="bg-gray-100 py-16">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">Preventive Health Checkups</h2>
          <p className="text-gray-600 text-lg mb-8 max-w-2xl mx-auto">
            Invest in your well-being with our comprehensive health packages designed for your specific needs.
          </p>
          <Link 
            to="/packages" // Assuming you will create a /packages route
            className="bg-green-600 text-white font-bold py-3 px-8 rounded-full text-lg hover:bg-green-700 transition-colors shadow-lg"
          >
            View Health Packages
          </Link>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
