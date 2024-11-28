# Blockchain Feedback Management - Documentation

This repository contains the development of a blockchain-based solution for managing feedback in e-commerce. The solution includes a NodeJS API, a WordPress plugin, and an endpoint for managing wallets and Decentralized Identifiers (DIDs).

## Prerequisites
Before starting, ensure the following are installed and configured:

- Node.js (latest version to run the API).
- WordPress with WooCommerce (latest version).
- PHP with OpenSSL enabled (default in most PHP installations).

# Setup Instructions
## 1. Clone the Repository
Clone this repository to your local machine:

```bash
git clone https://github.com/your-repo/blockchain-feedback.git
cd blockchain-feedback
```
## 2. API Setup
Navigate to the API folder:

```bash
cd api
```
Install the dependencies:

```bash
npm install
```

Install the dependencies:

```bash
node server.js
```

The API will be available at http://localhost:3000.

## 3. Wallet Setup
Navigate to the Wallet folder:

```bash
cd Wallet
```
Install the dependencies:

```bash
npm install
```

Install the dependencies:

```bash
node server.js
```

The API will be available at http://localhost:4000.

## 4. WordPress Plugin Setup

Navigate to the Wallet folder:

```bash
cd plugin
```
Compress the plugin into a .zip file:

```bash
zip -r blockchain-feedback-plugin.zip .
```

Access your WordPress admin dashboard:

- Go to Plugins -> Add New -> Upload Plugin.
- Upload the blockchain-feedback-plugin.zip file and activate the plugin.

Ensure WooCommerce is active and up-to-date.

## 5. Wallet and ID Creation

Access the wallet endpoint:

```bash
http://localhost:4000/create-wallet.html
```
Follow the instructions to create a wallet and generate a Decentralized Identifier (DID).

## 6. Register the E-commerce Platform

In the WordPress admin dashboard, navigate to:

```mathematica
Blockchain Feedback -> Connect E-Commerce Platform
```

Follow the steps to register your platform on the blockchain.

## 7. User Testing

### Create a Wallet for the User:

Access the wallet endpoint again

After creating the wallet for the user, create an e-commerce account by searching on the website:

```mathematica
My Account -> Account Details
```

Click on Connect to RMB and follow the steps to associate the user’s DID with the platform.

Simulate a Purchase and Provide Feedback:

- Simulate a purchase using the user account.
- After the purchase, provide feedback on the purchased product.
- Follow the instructions to validate the feedback using the wallet.

# Feedback Validation

## Using the WordPress Plugin

In WooCommerce, go to the product feedback section.

```mathematica
Validate Feedback with My Wallet
```
Follow the steps to ensure the feedback is correctly recorded.

## Using the API

Access the API endpoint:

```bash
http://localhost:3000/check-feedback
```
Download the JSON file of the feedback from the product page.

Upload the JSON to the endpoint and click on Verify.




