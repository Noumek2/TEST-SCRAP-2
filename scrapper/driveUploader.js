const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const DRIVE_UPLOAD_TIMEOUT_MS = parseInt(process.env.GOOGLE_DRIVE_UPLOAD_TIMEOUT_MS, 10) || 45000;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label + " timed out after " + ms + "ms"));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function parseServiceAccountFromEnv() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (error) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: " + error.message);
  }
}

function getDriveConfig() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const credentials = parseServiceAccountFromEnv();

  return {
    folderId,
    keyFile,
    credentials,
  };
}

function isGoogleDriveConfigured() {
  const config = getDriveConfig();
  return !!(config.folderId && (config.credentials || config.keyFile));
}

async function createDriveClient() {
  const config = getDriveConfig();
  if (!config.folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing");
  }

  const authOptions = {
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  };

  if (config.credentials) {
    authOptions.credentials = config.credentials;
  } else if (config.keyFile) {
    const resolvedKeyFile = path.isAbsolute(config.keyFile)
      ? config.keyFile
      : path.join(__dirname, config.keyFile);

    if (!fs.existsSync(resolvedKeyFile)) {
      throw new Error("Google service account file not found: " + resolvedKeyFile);
    }

    authOptions.keyFile = resolvedKeyFile;
  } else {
    throw new Error("Google Drive credentials are missing");
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  return google.drive({ version: "v3", auth });
}

async function uploadFileToDrive(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error("File not found for Drive upload: " + filePath);
  }

  const config = getDriveConfig();
  const drive = await createDriveClient();
  const fileName = options.fileName || path.basename(filePath);
  const mimeType = options.mimeType || "application/octet-stream";

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [config.folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id,name,webViewLink,webContentLink",
  });

  return response.data;
}

async function uploadFilesToDrive(files = []) {
  if (!isGoogleDriveConfigured()) {
    console.log("  [drive] Google Drive not configured - skipping");
    return [];
  }

  const uploaded = [];
  for (const file of files) {
    if (!file || !file.path) continue;

    try {
      console.log("  [drive] Uploading " + file.path + "...");
      const result = await withTimeout(
        uploadFileToDrive(file.path, {
          fileName: file.name,
          mimeType: file.mimeType,
        }),
        DRIVE_UPLOAD_TIMEOUT_MS,
        "Google Drive upload for " + path.basename(file.path)
      );
      uploaded.push(result);
      console.log("  [drive] Uploaded: " + (result.webViewLink || result.id));
    } catch (error) {
      console.error("  [drive] Upload failed for " + file.path + ": " + error.message);
    }
  }

  return uploaded;
}

module.exports = {
  getDriveConfig,
  isGoogleDriveConfigured,
  uploadFileToDrive,
  uploadFilesToDrive,
};
