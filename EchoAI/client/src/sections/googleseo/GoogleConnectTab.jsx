import GoogleConnect from "../../components/GoogleConnect.jsx";

export default function GoogleConnectTab() {
  return (
    <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-gray-100">
          Connect your Google account
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Link Google so EchoAI can surface your Business Profile, Ads,
          Analytics, and Search Console insights in one place.
        </p>
      </div>
      <GoogleConnect />
    </div>
  );
}
