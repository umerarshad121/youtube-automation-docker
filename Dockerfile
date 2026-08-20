FROM node:18-slim

COPY --from=mwader/static-ffmpeg:7.1.1 /ffmpeg /usr/local/bin/
COPY --from=mwader/static-ffmpeg:7.1.1 /ffprobe /usr/local/bin/

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
