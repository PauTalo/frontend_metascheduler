# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

# Want to help us make this template better? Share your feedback here: https://forms.gle/ybq9Krt8jtBL3iCk7

ARG NODE_VERSION=24

################################################################################
# Shared Node image for dependency installation and local development.
FROM node:${NODE_VERSION}-alpine as base

# Set working directory for the build stages.
WORKDIR /usr/src/app

# Install dependencies with cache support.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

################################################################################
# Development stage. Source code is expected to be bind-mounted by Compose.
FROM base as dev

# Copy the application source so the image can also run without a bind mount.
COPY . .

# Expose the Vite port used in Docker Compose.
EXPOSE 8080

# Run the Vite dev server in the foreground.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

################################################################################
# Use node image to build the static frontend assets.
FROM base as build

# Copy the application source and build the production bundle.
COPY . .
RUN npm run build

################################################################################
# Serve the built application with nginx.
FROM nginx:1.27-alpine as final

# Copy the nginx configuration and static files.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

# Expose the port that nginx listens on.
EXPOSE 8080

# Run nginx in the foreground.
CMD ["nginx", "-g", "daemon off;"]
