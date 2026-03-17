FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=7860
EXPOSE 7860
CMD ["node", "index.js"]