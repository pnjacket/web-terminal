FROM golang:1.22-alpine AS builder

WORKDIR /build

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
COPY frontend/ ./static/

RUN go build -o /app/web-terminal .

FROM alpine:3.19

RUN apk add --no-cache bash openssh-client ca-certificates && \
    mkdir -p /data

COPY --from=builder /app/web-terminal /usr/local/bin/web-terminal

EXPOSE 8080

CMD ["web-terminal"]
