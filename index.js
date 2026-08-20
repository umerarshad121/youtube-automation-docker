const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json({ limit: '50mb' }));

// Downloader with browser User-Agent to bypass Supabase 400 Error
const downloadFile = (fileUrl, outputPath) => {
  return new Promise((resolve, reject) => {
    const client = fileUrl.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    
    const request = client.get(fileUrl, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download ${fileUrl}: Status ${response.statusCode}`));
      }
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(outputPath);
      });
    });
    request.on('error', reject);
  });
};

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/process-video', async (req, res) => {
  let tempFiles = [];
  try {
    const { scenes } = req.body;
    if (!scenes || !Array.isArray(scenes)) {
      return res.status(400).json({ error: 'Invalid scenes' });
    }

    const clipPaths = [];
    const timestamp = Date.now();

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const localImg = `/tmp/img_${timestamp}_${i}.jpg`;
      const localAud = `/tmp/aud_${timestamp}_${i}.mp3`;
      const clipPath = `/tmp/clip_${timestamp}_${i}.mp4`;
      
      tempFiles.push(localImg, localAud, clipPath);

      // Local download
      await downloadFile(scene.imageUrl, localImg);
      await downloadFile(scene.audioUrl, localAud);

      // FFmpeg command using local files
      const command = `ffmpeg -y -loop 1 -i "${localImg}" -i "${localAud}" -vf "zoompan=z='min(zoom+0.0015,1.5)':d=125:s=1920x1080,format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -shortest "${clipPath}"`;
      await execPromise(command);
      clipPaths.push(clipPath);
    }

    // Concat
    const concatFilePath = `/tmp/concat_${timestamp}.txt`;
    const finalOutputPath = `/tmp/output_final_${timestamp}.mp4`;
    tempFiles.push(concatFilePath, finalOutputPath);

    fs.writeFileSync(concatFilePath, clipPaths.map(p => `file '${p}'`).join('\n'));
    await execPromise(`ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${finalOutputPath}"`);

    res.download(finalOutputPath, 'final_video.mp4', () => {
      tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
    });

  } catch (error) {
    console.error('Processing error:', error);
    tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
