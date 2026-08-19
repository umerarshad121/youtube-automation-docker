const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json());

app.post('/process-video', async (req, res) => {
  try {
    const { imageUrl, audioUrl } = req.body;
    const outputPath = '/tmp/output_cinematic.mp4';

    const command = `ffmpeg -y -i "${imageUrl}" -i "${audioUrl}" -vf "zoompan=z='min(zoom+0.0015,1.5)':d=125:s=1920x1080" -c:v libx264 -pix_fmt yuv420p -shortest ${outputPath}`;

    await execPromise(command);

    // Return video file as binary
    res.download(outputPath, 'output_cinematic.mp4', () => {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));