const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json({ limit: '50mb' })); // Barray arrays handle karne ke liye limit barha di hai

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'youtube-automation-ffmpeg' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/process-video', async (req, res) => {
  let tempFiles = [];
  try {
    const { scenes } = req.body;
    
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: 'No scenes array provided in request body' });
    }

    const clipPaths = [];
    const timestamp = Date.now();

    // 1. Har scene ke liye individual video clip generate karein
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imageUrl = scene.imageUrl;
      const audioUrl = scene.audioUrl;
      
      const clipPath = `/tmp/clip_${timestamp}_${i}.mp4`;
      tempFiles.push(clipPath);

      // FFmpeg command for individual scene
      const command = `ffmpeg -y -i "${imageUrl}" -i "${audioUrl}" -vf "zoompan=z='min(zoom+0.0015,1.5)':d=125:s=1920x1080" -c:v libx264 -pix_fmt yuv420p -shortest ${clipPath}`;
      
      await execPromise(command);
      clipPaths.push(clipPath);
    }

    // 2. FFmpeg concat ke liye text file banayein
    const concatFilePath = `/tmp/concat_${timestamp}.txt`;
    tempFiles.push(concatFilePath);
    
    const concatFileContent = clipPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(concatFilePath, concatFileContent);

    // 3. Saare clips ko milakar final output video banayein
    const finalOutputPath = `/tmp/output_final_${timestamp}.mp4`;
    tempFiles.push(finalOutputPath);

    const concatCommand = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${finalOutputPath}"`;
    await execPromise(concatCommand);

    // 4. Final video file client (n8n) ko bhej dein aur temporary files delete kardein
    res.download(finalOutputPath, 'final_video.mp4', () => {
      tempFiles.forEach(file => {
        if (fs.existsSync(file)) {
          try { fs.unlinkSync(file); } catch (e) {}
        }
      });
    });

  } catch (error) {
    console.error('Error processing video:', error);
    // Error anay par bhi temporary files saaf kardein
    tempFiles.forEach(file => {
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch (e) {}
      }
    });
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
server.timeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;