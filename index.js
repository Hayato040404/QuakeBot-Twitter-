const http = require('http');
const WebSocket = require('ws');
const { TwitterApi } = require('twitter-api-v2');

// X API credentials (using environment variables for Render)
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY || 'zzRNUt75v8eM6FqI48V7mjzN2',
  appSecret: process.env.TWITTER_API_SECRET || 'RDmFApoBJd1jQH2mMnLwQmjJvcExLxBcGhBVG7ElSubC5SM1mN',
  accessToken: process.env.TWITTER_ACCESS_TOKEN || '1821131988981706753-krbAweYEYMEwRnMYHoHQqwgIWLnMea',
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || 'A94cNkUHFJdz1lhvD2CD3KlS69dbPPWpojdtJOJqL6Ubs',
});

// WebSocket server endpoint
const wsUrl = 'wss://api.p2pquake.net/v2/ws';

// WebSocket reconnection interval (milliseconds)
const reconnectInterval = 5000;

// Environment variable PORT for Render
const PORT = process.env.PORT || 3000;

// HTTP server to satisfy Render requirements
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket client is running.');
});

server.listen(PORT, () => {
  console.log(`HTTP server is running on port ${PORT}`);
});

// WebSocket client initialization
let ws;

function connectWebSocket() {
  console.log('Connecting to WebSocket server...');
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('WebSocket connection established');
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      console.log("Received Data:", message);

      if (message.code === 551) {
        console.log('Processing earthquake data with code 551.');
        if (!message.earthquake) {
          console.error("Invalid earthquake data received.");
          return;
        }
        const earthquakeInfo = formatEarthquakeInfo(message.earthquake, messageキ
        await postToTwitter(earthquakeInfo);
      } else if (message.code === 552) {
        console.log('Processing tsunami warning data with code 552.');
        const tsunamiInfo = formatTsunamiWarningInfo(message);
        await postToTwitter(tsunamiInfo);
      } else {
        console.log(`Ignored message with code: ${message.code}`);
      }
    } catch (error) {
      console.error("Error processing message data:", error);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed. Reconnecting in 5 seconds...');
    setTimeout(connectWebSocket, reconnectInterval);
  });
}

function formatEarthquakeInfo(earthquake, message) {
  const time = new Date(earthquake.time);
  const date = time.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  const timeStr = time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  const hypocenter = earthquake.hypocenter.name;
  const maxScale = getScaleDescription(earthquake.maxScale);
  let magnitude = earthquake.hypocenter.magnitude;
  let depth = earthquake.hypocenter.depth;

  depth = depth === -1 ? '不明' : depth === 0 ? 'ごく浅い' : `約${depth}km`;
  magnitude = magnitude === -1 ? '不明' : magnitude.toFixed(1);

  const pointsByScale = groupPointsByScale(message.points);
  const tsunamiInfo = getTsunamiInfo(earthquake.domesticTsunami);
  const freeFormComment = message.comments?.freeFormComment || '';

  // 震度速報
  if (message.issue && message.issue.type === 'ScalePrompt') {
    let formattedMessage = `【震度速報】 ${date} ${timeStr}頃\n【震度3以上が観測された地域】\n`;
    Object.keys(pointsByScale).sort((a, b) => b - a).forEach(scale => {
      formattedMessage += `震度${scale}: `;
      Object.keys(pointsByScale[scale]).forEach(pref => {
        formattedMessage += `${pref}(${pointsByScale[scale][pref].join(', ')}) `;
      });
      formattedMessage += '\n';
    });
    return formattedMessage.trim();
  }

  // 通常の地震情報
  let formattedMessage = `【地震情報】${date} ${timeStr}頃、${hypocenter}を震源とする最大震度${maxScale}の地震がありました。Mは${magnitude} 、深さは${depth}を観測しています。\n${tsunamiInfo}\n[各地の震度]`;
  const scaleOrder = ['7', '6強', '6弱', '5強', '5弱', '4', '3', '2', '1'];
  const sortedScales = Object.keys(pointsByScale).sort((a, b) => scaleOrder.indexOf(a) - scaleOrder.indexOf(b));

  sortedScales.forEach(scale => {
    formattedMessage += `\n震度${scale}: `;
    Object.keys(pointsByScale[scale]).forEach(pref => {
      const uniqueCities = new Set();
      pointsByScale[scale][pref].forEach(addr => {
        const cityMatch = addr.match(/([^市区町村]+[市区町村])/);
        if (cityMatch) uniqueCities.add(cityMatch[1]);
      });
      formattedMessage += `${pref}(${Array.from(uniqueCities).join(', ')}) `;
    });
  });

  if (freeFormComment) {
    formattedMessage += `\n情報: ${freeFormComment}`;
  }

  return formattedMessage.trim();
}

function formatTsunamiWarningInfo(message) {
  if (message.cancelled) {
    return "津波警報等は解除されました。";
  }

  const warnings = {
    MajorWarning: '[大津波警報🟪] 大津波警報発表！今すぐ避難！\n地域:',
    Warning: '[津波警報🟥] 津波警報発表！高台へ避難！\n地域:',
    Watch: '[津波注意報🟨] 津波注意報発表。海から離れて！\n地域:',
    Unknown: '[津波情報❓] 津波状況不明。情報に注意。\n地域:'
  };

  let formattedMessage = warnings[message.areas[0]?.grade] || '[津波情報] 処理失敗。\n地域:';
  const areas = message.areas.map(area => {
    const name = area.name;
    const maxHeight = area.maxHeight.description;
    return `${name}(${maxHeight})`;
  }).join(', ');

  formattedMessage += `\n${areas}\n津波は1mでも危険！`;
  if (message.areas[0]?.grade === 'MajorWarning') {
    formattedMessage += `\n⚠️絶対避難⚠️`;
  }

  return formattedMessage.trim();
}

function groupPointsByScale(points) {
  const pointsByScale = {};
  points.forEach(point => {
    const scale = getScaleDescription(point.scale);
    const addr = point.addr;
    const prefecture = point.pref;

    if (!scale) return;

    pointsByScale[scale] = pointsByScale[scale] || {};
    pointsByScale[scale][prefecture] = pointsByScale[scale][prefecture] || [];
    pointsByScale[scale][prefecture].push(addr);
  });
  return pointsByScale;
}

function getScaleDescription(scale) {
  const scaleDescriptions = {
    10: '1',
    20: '2',
    30: '3',
    40: '4',
    45: '5弱',
    50: '5強',
    55: '6弱',
    60: '6強',
    70: '7'
  };
  return scaleDescriptions[scale] || '不明';
}

function getTsunamiInfo(domesticTsunami) {
  const tsunamiMessages = {
    "None": "この地震による津波の心配はありません。",
    "Unknown": "現在、津波情報が入っていません。今後の情報に注意してください。",
    "Checking": "津波は調査中です。",
    "NonEffective": "海面変動の可能性ありすが、被害の心配はありません。",
    "Watch": "🟨津波注意報発表中🟨",
    "Warning": "⚠️津波警報等発表中。⚠️"
  };
  return tsunamiMessages[domesticTsunami] || "（津波情報なし）";
}

async function postToTwitter(message) {
  // Truncate to 139 characters and append "…" if needed
  let tweet = message;
  if (tweet.length > 139) {
    tweet = tweet.substring(0, 139) + '…';
  }

  try {
    // Use v2 API to post tweet
    await twitterClient.v2.tweet({ text: tweet });
    console.log('Tweet posted successfully:', tweet);
  } catch (error) {
    if (error.code === 429) {
      // Handle rate limit error
      const retryAfter = error.headers?.['retry-after'] || 60;
      console.error(`Rate limit exceeded. Retrying after ${retryAfter} seconds.`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      // Retry once
      try {
        await twitterClient.v2.tweet({ text: tweet });
        console.log('Tweet posted successfully on retry:', tweet);
      } catch (retryError) {
        console.error('Failed to post tweet on retry:', retryError);
      }
    } else {
      console.error('Failed to post tweet:', error);
    }
  }
}

connectWebSocket();
