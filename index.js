const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json({ limit: '50mb' }));

// Stream downloader using Axios (Fixes Supabase 400 Bad Request)
const downloadFile = async (fileUrl, outputPath) => {
  const writer = fs.createWriteStream(outputPath);
  
  const response = await axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*'
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
};

app.get('/', (req, res) => res.json({ status: 'ok', service: 'youtube-automation-ffmpeg' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/process-video', async (req, res) => {
  let tempFiles = [];
  try {
    const { scenes } = req.body;
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: 'No scenes array provided in request body' });
    }

    const clipPaths = [];
    const timestamp = Date.now();

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const localImg = `/tmp/img_${timestamp}_${i}.jpg`;
      const localAud = `/tmp/aud_${timestamp}_${i}.mp3`;
      const clipPath = `/tmp/clip_${timestamp}_${i}.mp4`;
      
      tempFiles.push(localImg, localAud, clipPath);

      // Download both assets asynchronously
      await Promise.all([
        downloadFile(scene.imageUrl, localImg),
        downloadFile(scene.audioUrl, localAud)
      ]);

      // FFmpeg processing using local files
      const command = `ffmpeg -y -loop 1 -i "${localImg}" -i "${localAud}" -vf "zoompan=z='min(zoom+0.0015,1.5)':d=125:s=1920x1080,format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -shortest "${clipPath}"`;
      await execPromise(command);
      clipPaths.push(clipPath);
    }

    // Concat files
    const concatFilePath = `/tmp/concat_${timestamp}.txt`;
    const finalOutputPath = `/tmp/output_final_${timestamp}.mp4`;
    tempFiles.push(concatFilePath, finalOutputPath);

    fs.writeFileSync(concatFilePath, clipPaths.map(p => `file '${p}'`).join('\n'));
    await execPromise(`ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${finalOutputPath}"`);

    // Return file
    res.download(finalOutputPath, 'final_video.mp4', () => {
      tempFiles.forEach(f => {
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (e) {}
      });
    });

  } catch (error) {
    console.error('Processing error:', error);
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (e) {}
    });
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
server.timeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;
