const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  generateKeyPair,
  exportSPKI,
  exportPKCS8,
  SignJWT,
  importPKCS8,
  importSPKI,
  jwtVerify,
  CompactEncrypt,
  compactDecrypt,
} = require("jose");

const querystring = require("querystring");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = 4000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const walletDir = path.join(__dirname, "wallet");
const chainDir = path.join(__dirname, "chain");

const registrosFilePath = path.join(__dirname, "chain", "records_ebsi.json");

let tempFeedback = {};
let tempAuditFeedback = {};

function generateHash(id) {
  return crypto.createHash("sha256").update(id).digest("hex");
}

async function getPublickKey(idHash) {
  const records = loadRecords_ebsi();
  const recordFound = records.find(record => record.idHash === idHash);

  if (!recordFound) {
    throw new Error("Public key not found for given EID.");
  }

  return recordFound.publicKey;
}

function walletExists(idHash) {
  const walletPath = path.join(walletDir, `${idHash}.json`);
  return fs.existsSync(walletPath);
}

function saveData(idHash, did, privateKey) {
  const walletPath = path.join(walletDir, `${idHash}.json`);
  if (fs.existsSync(walletPath)) {
    const data = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    data.dids.push({ did, "private-key": privateKey });
    fs.writeFileSync(walletPath, JSON.stringify(data));
  }
}

function loadWalletData(idHash) {
  const walletPath = path.join(walletDir, `${idHash}.json`);
  if (fs.existsSync(walletPath)) {
    return JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  }
  return null;
}

function loadRecords_ebsi() {
  if (fs.existsSync(registrosFilePath)) {
    try {
      const data = fs.readFileSync(registrosFilePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error reading or parsing records_ebsi.json file:", error);
      return [];
    }
  }
  return [];
}

function decryptData(privateKey, encrypted_data) {
  const buffer = Buffer.from(encrypted_data, "base64");
  const decrypted = crypto.privateDecrypt(privateKey, buffer);
  return decrypted.toString("utf-8");
}

async function generateRSAKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256"); 

  const publicKeyPem = await exportSPKI(publicKey); 
  const privateKeyPem = await exportPKCS8(privateKey); 

  return { publicKey: publicKeyPem, privateKey: privateKeyPem };
}

function generateHashSHA256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

//Create WALLET --------------
app.post("/wallet/create/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "EID is mandatory." });
  }

  const idHash = generateHash(id);

  const recordsPath = path.join(chainDir, "records_ebsi.json");
  let records = [];

  if (fs.existsSync(recordsPath)) {
    records = JSON.parse(fs.readFileSync(recordsPath, "utf-8"));
  }

  const existingRegistry = records.find(registro => registro.idHash === idHash);

  if (existingRegistry) {
    return res
      .status(401)
      .json({ message: `Wallet already exists for EID ${id}.` });
  }

  const { publicKey, privateKey } = await generateRSAKeys();

  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir);
  }

  const did = uuidv4();

  const walletPath = path.join(walletDir, `${idHash}.json`);

  if (!fs.existsSync(walletPath)) {
    const walletData = {
      did: {
        did: `did:ebsi:${did}`,
        idHash: idHash,
        "private-key": privateKey,
      },
      dids: [],
    };
    fs.writeFileSync(walletPath, JSON.stringify(walletData, null, 2));
  }


  if (!existingRegistry) {
    const newRegistration = {
      did: `did:ebsi:${did}`,
      idHash: idHash,
      publicKey: publicKey,
      timestamp: new Date().toISOString(),
    };

    records.push(newRegistration);
    fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2));
  }

  res
    .status(200)
    .json({ message: `Wallet created for EID ${id}.`, hash: idHash });
});
//END --------------

// generateConfirmationLink
function generateConfirmationLink(
  idHash,
  id,
  rater,
  subject,
  order,
  feedback,
  platform,
  context
) {
  const baseUrl = `http://localhost:4000/wallet/${idHash}/sign-feedback`;

  const queryParams = querystring.stringify({
    id,
    rater,
    subject,
    order,
    feedback: JSON.stringify(feedback),
    platform,
    context,
  });

  return `${baseUrl}?${queryParams}`;
}
async function getPrivateKey(pvKey) {
  const privateKey = await importPKCS8(pvKey, "RS256");
  return privateKey;
}

//FUNCTIONS FOR SUBMIT FEEDBACK ------------------------------------------------------------------------
async function connectToAPI(idHash, raterDid) {
  const apiUrl = `http://localhost:3000/api/connect-wallet`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idHash, raterDid }),
    });

    if (!response.ok) {
      throw new Error("Error requesting the connection challenge.");
    }

    const { challenge } = await response.json();
    return challenge;
  } catch (error) {
    console.error("Error connecting to the API:", error.message);
    throw error;
  }
}

async function validateConnection(idHash, raterDid, challenge) {
  const info = loadWalletData(idHash);
  const didInfo = info.dids.find(didObj => didObj.did === raterDid);

  if (!didInfo) {
    throw new Error(`DID ${raterDid} not found in the wallet.`);
  }

  const privateKey = didInfo["private-key"];

  let decryptedChallenge;
  try {
    const importedPrivateKey = await importPKCS8(privateKey, "RSA-OAEP-256");
    const { plaintext } = await compactDecrypt(challenge, importedPrivateKey);
    decryptedChallenge = new TextDecoder().decode(plaintext);
  } catch (error) {
    console.error("Error decrypting the challenge:", error.message);
    throw error;
  }

  const apiUrl = `http://localhost:3000/api/validate-wallet-response`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idHash, decryptedChallenge }),
    });

    if (!response.ok) {
      throw new Error("Error validating the connection.");
    }

    const { connectionToken } = await response.json();

    return connectionToken;
  } catch (error) {
    console.error(
      "Error validating the connection with the API:",
      error.message
    );
    throw error;
  }
}

async function addToLedger(idHash, feedbackData, connectionToken) {
  const info = loadWalletData(idHash);
  const didInfo = info.dids.find(didObj => didObj.did === feedbackData.rater);

  if (!didInfo) {
    throw new Error(`DID ${feedbackData.rater} not found in the wallet.`);
  }

  let privateKey = didInfo["private-key"];
  privateKey = await getPrivateKey(privateKey);

  if (!tempFeedback || Object.keys(tempFeedback).length === 0) {
    throw new Error(`This feedback cannot be submitted.`);
  }
  const feedbackHash = generateHashSHA256(JSON.stringify(tempFeedback));

  tempFeedback = {};

  let jwsFeedback;
  try {
    jwsFeedback = await new SignJWT({ feedbackHash: feedbackHash })
      .setProtectedHeader({ alg: "RS256" })
      .sign(privateKey);
  } catch (error) {
    throw new Error("Error signing the feedback.");
  }

  const apiUrl = `http://localhost:3000/api/add-to-ledger`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: feedbackData.id,
        rater: feedbackData.rater,
        subject: feedbackData.subject,
        platform: feedbackData.platform,
        timestamp: new Date().toISOString(),
        jws: jwsFeedback,
        idHash: idHash,
        connectionToken,
      }),
    });

    if (!response.ok) {
      throw new Error("Error sending feedback to the ledger.");
    }
  } catch (error) {
    throw new Error("Error sending feedback to the API.");
  }
}
//END ------------------------------------------------------------------------

// SUBMIT FEEDBACK RMB  ------------------------------------------------------------------------
app.post("/wallet/:idHash/generate-link", async (req, res) => {
  const { idHash } = req.params;
  const { rater, jwt, siteUrl } = req.body;

  if (!rater || !jwt) {
    return res
      .status(400)
      .json({ message: "Missing parameters in the request" });
  }

  const info = loadWalletData(idHash);

  const didInfo = info.dids.find(didObj => didObj.did === rater);
  if (!didInfo) {
    return res.status(404).json({
      message: `DID ${rater} not found in the wallet.`,
    });
  }
  const privateKey = didInfo["private-key"];

  let decryptedFeedback;
  try {
    const importedPrivateKey = await importPKCS8(privateKey, "RSA-OAEP-256");
    const { plaintext } = await compactDecrypt(jwt, importedPrivateKey);

    const decryptedText = new TextDecoder().decode(plaintext);

    decryptedFeedback = JSON.parse(decryptedText);

    tempFeedback = decryptedFeedback;
  } catch (error) {
    console.error("Error decrypting data:", error);
    return res.status(500).json({
      message: "Error decrypting the data",
      error: error.message,
    });
  }

  const link = generateConfirmationLink(
    idHash,
    decryptedFeedback.id,
    decryptedFeedback.rater,
    decryptedFeedback.subject,
    decryptedFeedback.order,
    decryptedFeedback.feedback,
    decryptedFeedback.platform,
    siteUrl
  );

  res.status(200).json({ message: "Confirmation link generated", link });
});

app.get("/wallet/:idHash/sign-feedback", (req, res) => {
  const { idHash } = req.params;

  const { id, rater, subject, order, feedback, platform, context } = req.query;

  if (!id || !rater || !subject || !platform || !feedback) {
    return res.status(400).json({ message: "Missing or invalid parameters" });
  }

  let parsedFeedback;
  try {
    parsedFeedback = JSON.parse(feedback);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Error processing feedback", error: error.message });
  }

  res.render("sign-feedback", {
    idHash,
    id,
    rater,
    subject,
    order,
    feedback: parsedFeedback,
    platform,
    context,
  });
});

app.post("/wallet/:idHash/confirm", async (req, res) => {
  const { idHash } = req.params;
  const { id, rater, subject, feedback, platform, order, context, confirm } =
    req.body;

  const info = loadWalletData(idHash);
  const didInfo = info.dids.find(didObj => didObj.did === rater);

  if (!didInfo) {
    return res
      .status(404)
      .json({ message: `DID ${rater} not found in the wallet.` });
  }

  try {
    if (confirm === "false") {
      tempFeedback = {};
      return res
        .status(200)
        .json({ message: "Feedback has been rejected and discarded." });
    }

    const challenge = await connectToAPI(idHash, rater);
    const connectionToken = await validateConnection(idHash, rater, challenge);

    const feedbackData = {
      id,
      rater,
      subject,
      platform,
      feedback,
    };

    await addToLedger(idHash, feedbackData, connectionToken);

    return res
      .status(200)
      .json({ message: "Feedback successfully added to the ledger." });
  } catch (error) {
    console.error("Error during the confirmation process:", error.message);
    return res.status(500).json({
      message: "Error during the confirmation process",
      error: error.message,
    });
  }
});
// END ------------------------------------------------------------------------

// REGISTER RMB ------------------------------------------------------------------------
app.get("/wallet/get-public-key/:idHash", async (req, res) => {
  const { idHash } = req.params;

  const publicKey = await getPublickKey(idHash);

  if (!publicKey) {
    return res
      .status(404)
      .json({ message: "Public key not found for given ID." });
  }

  res.status(200).json({ publicKey });
});

app.post("/wallet/register/:idHash", async (req, res) => {
  const { idHash } = req.params;
  const { did } = req.body;

  const { publicKey, privateKey } = await generateRSAKeys();

  if (!idHash || !did || !privateKey) {
    return res
      .status(400)
      .json({ message: "Hash of EID, DID and private key are required." });
  }

  saveData(idHash, did, privateKey);
  res.status(200).json({ message: "Data saved successfully", publicKey });
});

app.get("/wallet/exists/:idHash", (req, res) => {
  const { idHash } = req.params;
  if (walletExists(idHash)) {
    return res.status(200).json({ message: "Wallet exists.", exists: true });
  } else {
    return res
      .status(404)
      .json({ message: "wallet does not exist.", exists: false });
  }
});

app.get("/wallet/:idHash/generate-vc", (req, res) => {
  const { idHash } = req.params;
  const { encrypted_data } = req.query;

  const info = loadWalletData(idHash);

  if (!info || !info.did) {
    return res
      .status(404)
      .json({ message: "No data found for the given EID." });
  }

  const privateKey = info.did["private-key"];

  let decryptedword;
  try {
    decryptedword = decryptData(privateKey, encrypted_data);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to decrypt.", error: error.message });
  }

  res.render("confirm-vc", {
    id: idHash,
    decryptedword: decryptedword,
  });
});
// END ------------------------------------------------------------------------

// Verify
app.get("/wallet/verify", (req, res) => {
  const jsonFeedback = req.query.jsonFeedback;
  let parsedFeedback;
  try {
    parsedFeedback = JSON.parse(jsonFeedback);
  } catch (error) {
    return res.status(400).send("Invalid JSON format.");
  }
  tempAuditFeedback = parsedFeedback;
  const refererUrl = req.get("Referer") || req.get("Origin");

  res.render("verify-feedback", {
    feedback: parsedFeedback,
    refererUrl: refererUrl,
  });
});

app.post("/wallet/verify-feedback", async (req, res) => {
  const feedbackJson = req.body;
  const {
    id,
    platform,
    order,
    subject,
    rater,
    feedback,
    "@context": context,
  } = feedbackJson;

  try {
    const response = await fetch("http://localhost:3000/api/get-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, rater, platform }),
    });

    if (!response.ok) {
      throw new Error("Error fetching API feedback.");
    }

    const { feedbackStored, publicKeyPEM } = await response.json();
    const publicKey = await importSPKI(publicKeyPEM, "RS256");
    const { payload: feedbackDecrypt } = await jwtVerify(
      feedbackStored.feedbackHash,
      publicKey
    );

    if (!tempAuditFeedback || Object.keys(tempAuditFeedback).length === 0) {
      throw new Error(`This feedback cannot be audited.`);
    }

    const payloadCurrentHash = generateHashSHA256(
      JSON.stringify(tempAuditFeedback)
    );

    if (payloadCurrentHash === feedbackDecrypt.feedbackHash) {
      return res.json({
        message: "The feedback is intact and has not been changed.",
      });
    } else {
      return res.json({
        message: "Feedback has been tampered with. Hash diverges.",
      });
    }
  } catch (error) {
    console.error("Error checking feedback:", error.message);
    return res.status(500).json({ message: "Error checking feedback." });
  }
});
// END ------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

// Iniciar o servidor da Wallet
app.listen(port, () => {
  console.log(`Servidor da Wallet rodando na porta ${port}`);
});
