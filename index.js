const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json({ limit: '100mb' }));

// Stream downloader with strict error handling & auto-retry headers
const downloadFile = async (fileUrl, outputPath) => {
  const writer = fs.createWriteStream(outputPath);

  try {
    const response = await axios({
      method: 'get',
      url: fileUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      },
      timeout: 45000
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
      response.data.on('error', (err) => {
        writer.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    fs.unlink(outputPath, () => {});
    const status = error.response ? error.response.status : 'NETWORK_ERR';
    throw new Error(`Download Failed (${status}) -> URL: ${fileUrl}`);
  }
};

app.get('/', (req, res) => res.json({ status: 'ok', service: 'youtube-automation-ffmpeg' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/process-video', async (req, res) => {
  console.log('[REQUEST RECEIVED] Starting video generation pipeline...');
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

      console.log(`[SCENE ${i + 1}] Downloading assets...`);
      await Promise.all([
        downloadFile(scene.imageUrl, localImg),
        downloadFile(scene.audioUrl, localAud)
      ]);

      console.log(`[SCENE ${i + 1}] Rendering video clip with FFmpeg...`);
      // Scaling + Centering + Zoompan filter safely wrapped
      const command = `ffmpeg -y -loop 1 -i "${localImg}" -i "${localAud}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0015,1.3)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -shortest "${clipPath}"`;
      
      await execPromise(command);
      clipPaths.push(clipPath);
    }

    // Concatenate all scene clips
    const concatFilePath = `/tmp/concat_${timestamp}.txt`;
    const finalOutputPath = `/tmp/output_final_${timestamp}.mp4`;
    tempFiles.push(concatFilePath, finalOutputPath);

    fs.writeFileSync(concatFilePath, clipPaths.map(p => `file '${p}'`).join('\n'));
    
    console.log('[CONCAT] Merging all scenes into final video...');
    await execPromise(`ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${finalOutputPath}"`);

    console.log('[SUCCESS] Video generated! Sending response back to n8n...');
    res.download(finalOutputPath, 'final_video.mp4', () => {
      tempFiles.forEach(f => {
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (e) {}
      });
    });

  } catch (error) {
    console.error('[PROCESS ERROR]', error.message);
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (e) {}
    });
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
server.timeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;
