require("dotenv").config();

const adsSdk = require("facebook-nodejs-business-sdk");

const FacebookAdsApi = adsSdk.FacebookAdsApi;

const appId = process.env.FACEBOOK_APP_ID;
const appSecret = process.env.FACEBOOK_APP_SECRET;
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

let api = null;

if (accessToken) {
  api = FacebookAdsApi.init(accessToken);
  if (process.env.NODE_ENV !== "production") {
    api.setDebug(true);
  }
} else {
  console.warn(
    "Warning: FACEBOOK_ACCESS_TOKEN is not set. Facebook API calls will fail until it is configured."
  );
}

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v21.0";

module.exports = {
  adsSdk,
  api,
  GRAPH_VERSION,
  appId,
  appSecret,
  accessToken,
};
