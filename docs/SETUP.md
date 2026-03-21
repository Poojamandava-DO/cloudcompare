# CloudCompare — Customer Setup Guide

**Prepared by:** Pooja Mandava, Sr. Technical Account Manager  
**Product:** CloudCompare — DigitalOcean vs AWS Cost Advisor  
**Live URL:** http://138.197.62.176  

---

## Introduction

This guide walks your team through deploying CloudCompare on DigitalOcean Kubernetes (DOKS) from scratch. CloudCompare is a production-grade SaaS application that helps your team compare cloud infrastructure costs between DigitalOcean and AWS across multiple workload types.

By the end of this guide your team will have:
- A fully containerized Node.js application running on Kubernetes
- A DigitalOcean Load Balancer distributing traffic across 3 pods
- Horizontal Pod Autoscaler automatically scaling based on CPU usage
- A CI/CD pipeline that deploys every code change automatically
- A private container registry storing your Docker images securely

---

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Tool Installation — macOS](#tool-installation--macos)
- [Tool Installation — Windows](#tool-installation--windows)
- [Tool Installation — Linux (Ubuntu)](#tool-installation--linux-ubuntu)
- [Step 1: Authenticate with DigitalOcean](#step-1-authenticate-with-digitalocean)
- [Step 2: Create Container Registry](#step-2-create-container-registry)
- [Step 3: Build and Push Docker Image](#step-3-build-and-push-docker-image)
- [Step 4: Create DOKS Cluster](#step-4-create-doks-cluster)
- [Step 5: Connect Registry to Cluster](#step-5-connect-registry-to-cluster)
- [Step 6: Deploy the Application](#step-6-deploy-the-application)
- [Step 7: Install Metrics Server](#step-7-install-metrics-server)
- [Step 8: Verify Deployment](#step-8-verify-deployment)
- [Step 9: Set Up CI/CD Pipeline](#step-9-set-up-cicd-pipeline)
- [Step 10: Load Testing](#step-10-load-testing)
- [Cost Summary](#cost-summary)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview
```
Developer
↓
GitHub Repository (Source Code)
↓
GitHub Actions (CI/CD Pipeline — triggered on every push to main)
↓
Docker Image Build and Push (DigitalOcean Container Registry)
↓
DOKS Cluster (Deployment via YAML)
↓
Kubernetes Deployment → 3 Pods running CloudCompare (Node.js)
↓
Horizontal Pod Autoscaler (scales pods 3→10 based on CPU @ 60%)
↓
Kubernetes Service (LoadBalancer)
↓
User accesses via EXTERNAL-IP (138.197.62.176)
```

---

## Prerequisites

Before starting, make sure you have:

- A **DigitalOcean account** with billing set up
- A **GitHub account**
- A **DigitalOcean API token** (generated from cloud.digitalocean.com/account/api/tokens)
- Basic familiarity with the command line/terminal

---

## Tool Installation — macOS

### 1. Install Homebrew (Package Manager)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Verify
brew --version
```

### 2. Install Node.js
```bash
brew install node

# Verify
node --version
```

### 3. Install Docker Desktop
```bash
brew install --cask docker
```
> After installation, open **Docker Desktop** from Applications and wait for the engine to start (green status in menu bar).
```bash
# Verify
docker --version
```

### 4. Install kubectl
```bash
brew install kubectl

# Verify
kubectl version --client
```

### 5. Install doctl (DigitalOcean CLI)
```bash
brew install doctl

# Verify
doctl version
```

### 6. Install Git
```bash
brew install git

# Verify
git --version
```

---

## Tool Installation — Windows

### 1. Install Chocolatey (Package Manager)
Open PowerShell as Administrator and run:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

### 2. Install Node.js
```powershell
choco install nodejs

# Verify
node --version
```

### 3. Install Docker Desktop
Download and install from: https://www.docker.com/products/docker-desktop

> After installation, open **Docker Desktop** and wait for it to start.
```powershell
# Verify
docker --version
```

### 4. Install kubectl
```powershell
choco install kubernetes-cli

# Verify
kubectl version --client
```

### 5. Install doctl
```powershell
choco install doctl

# Verify
doctl version
```

### 6. Install Git
```powershell
choco install git

# Verify
git --version
```

---

## Tool Installation — Linux (Ubuntu)

### 1. Update packages
```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 2. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
```

### 3. Install Docker
```bash
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Verify
docker --version
```

### 4. Install kubectl
```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Verify
kubectl version --client
```

### 5. Install doctl
```bash
cd ~
wget https://github.com/digitalocean/doctl/releases/download/v1.100.0/doctl-1.100.0-linux-amd64.tar.gz
tar xf ~/doctl-1.100.0-linux-amd64.tar.gz
sudo mv ~/doctl /usr/local/bin

# Verify
doctl version
```

### 6. Install Git
```bash
sudo apt-get install -y git

# Verify
git --version
```

---

## Step 1: Authenticate with DigitalOcean
```bash
# Initialize doctl with your API token
doctl auth init
# Paste your API token when prompted

# Verify authentication
doctl account get
```

**Expected Output:**
```
User Email                    Team       Droplet Limit    Status
your@email.com                My Team    3                active
```

---

## Step 2: Create Container Registry

A private container registry stores your Docker images securely inside DigitalOcean's network — faster pulls and no public exposure.
```bash
doctl registry create cloudcompare-registry --region nyc3

# Verify
doctl registry repository list
```

**Expected Output:**
```
Name            Latest Tag    Tag Count    Updated At
cloudcompare                  1            2026-03-21...
```

---

## Step 3: Build and Push Docker Image
```bash
# Clone the repository
git clone https://github.com/Poojamandava-DO/cloudcompare.git
cd cloudcompare

# Authenticate Docker with your DOCR
doctl registry login

# Build for linux/amd64 — required for DOKS nodes
# Note: Apple Silicon (M1/M2/M3) builds arm64 by default
# DOKS runs amd64 Linux — this flag ensures compatibility
docker buildx build --platform linux/amd64 \
  -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest \
  --push .
```

**Expected Output:**
```
=> pushing manifest for registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest
=> [auth] cloudcompare-registry/cloudcompare:pull,push token for registry.digitalocean.com
```

---

## Step 4: Create DOKS Cluster

### Option A: Using doctl (Recommended)
```bash
doctl kubernetes cluster create cloudcompare-cluster \
  --region nyc3 \
  --version latest \
  --node-pool "name=cloudcompare-pool;size=s-2vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" \
  --wait
# --wait ensures cluster is fully ready before proceeding
```

### Option B: Using DigitalOcean Console
1. Go to [cloud.digitalocean.com/kubernetes](https://cloud.digitalocean.com/kubernetes)
2. Click **Create Kubernetes Cluster**
3. Configure:
   - **Region:** NYC3
   - **Version:** Latest stable
   - **Node Pool Size:** s-2vcpu-2gb
   - **Node Count:** 2
   - **Autoscaling:** Enabled (Min: 2, Max: 3)
4. Click **Create Cluster** and wait for provisioning

**Expected Output:**
```
ID                                    Name                   Region  Status
01082a30-xxxx-xxxx-xxxx-xxxxxxxxxxxx  cloudcompare-cluster   nyc3    running
```

### Connect kubectl to your cluster
```bash
# This saves the cluster credentials to your local kubeconfig
doctl kubernetes cluster kubeconfig save cloudcompare-cluster

# Verify nodes are ready
kubectl get nodes
```

**Expected Output:**
```
NAME                      STATUS   ROLES    AGE   VERSION
cloudcompare-pool-xxxxx   Ready    <none>   2m    v1.35.1
cloudcompare-pool-xxxxx   Ready    <none>   2m    v1.35.1
```

---

## Step 5: Connect Registry to Cluster
```bash
# Creates a Kubernetes secret with DOCR credentials
# Allows DOKS to pull your private images automatically
doctl registry kubernetes-manifest | kubectl apply -f -

# Create a dedicated namespace to isolate app resources
# Best practice — never deploy apps into the default namespace
kubectl create namespace cloudcompare

# Grant the namespace permission to pull from your registry
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
```

---

## Step 6: Deploy the Application

Apply Kubernetes configs in order — ConfigMap first since pods need it before starting:
```bash
# App configuration (environment variables)
kubectl apply -f k8s/configmap.yaml

# Deployment — 3 replicas with health probes and resource limits
kubectl apply -f k8s/deployment.yaml

# Service — creates DigitalOcean Load Balancer with public IP
kubectl apply -f k8s/service.yaml

# HPA — autoscales pods between 3 and 10 based on CPU
kubectl apply -f k8s/hpa.yaml
```

---

## Step 7: Install Metrics Server

The metrics server is required for HPA to read CPU usage from pods. Without it HPA shows `<unknown>` and cannot make scaling decisions.
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Wait 2 minutes then verify HPA is collecting metrics
kubectl get hpa -n cloudcompare
```

**Expected Output:**
```
NAME               REFERENCE                 TARGETS       MINPODS   MAXPODS   REPLICAS
cloudcompare-hpa   Deployment/cloudcompare   cpu: 1%/60%   3         10        3
```

---

## Step 8: Verify Deployment
```bash
# Check all 3 pods are running
kubectl get pods -n cloudcompare

# Check Load Balancer has a public IP
kubectl get services -n cloudcompare

# Check resource usage
kubectl top pods -n cloudcompare
```

**Expected Output:**
```bash
# Pods
NAME                            READY   STATUS    RESTARTS   AGE
cloudcompare-65cb59cc59-bg4jh   1/1     Running   0          5m
cloudcompare-65cb59cc59-cv44m   1/1     Running   0          5m
cloudcompare-65cb59cc59-ltmsp   1/1     Running   0          5m

# Services
NAME                   TYPE           EXTERNAL-IP      PORT(S)
cloudcompare-service   LoadBalancer   138.197.62.176   80:31896/TCP

# Resource usage
NAME                            CPU(cores)   MEMORY(bytes)
cloudcompare-65cb59cc59-bg4jh   3m           29Mi
cloudcompare-65cb59cc59-cv44m   1m           36Mi
cloudcompare-65cb59cc59-ltmsp   1m           27Mi
```

Open your browser and visit the **EXTERNAL-IP** to confirm the app is live! ✅

---

## Step 9: Set Up CI/CD Pipeline

Every push to the `main` branch automatically builds, pushes, and deploys a new version to DOKS with zero downtime.

### Add GitHub Secret
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add:
   - **Name:** `DIGITALOCEAN_ACCESS_TOKEN`
   - **Value:** your DO API token

### Test the Pipeline
Make any small change to the code and push:
```bash
git add .
git commit -m "test: trigger ci/cd pipeline"
git push origin main
```

Go to the **Actions** tab on GitHub and watch the pipeline run automatically.

**Pipeline Steps:**
```
✅ Checkout code
✅ Install doctl
✅ Login to DOCR
✅ Build Docker image
✅ Push to DOCR
✅ Connect to DOKS
✅ Apply Kubernetes configs
✅ Verify rollout
```

---

## Step 10: Load Testing

Validate your autoscaling works as expected before going to production.
```bash
# Install k6
brew install k6        # macOS
choco install k6       # Windows
sudo apt install k6    # Linux

# Run load test — 150 virtual users for 3 minutes
k6 run --vus 150 --duration 3m k6-load-test.js

# Watch HPA scale in real time (separate terminal)
kubectl get hpa -n cloudcompare --watch
```

**Expected HPA Behavior:**
```
NAME               TARGETS        REPLICAS
cloudcompare-hpa   cpu: 1%/60%    3        ← idle
cloudcompare-hpa   cpu: 54%/60%   3        ← load increasing
cloudcompare-hpa   cpu: 115%/60%  6        ← scaled up!
cloudcompare-hpa   cpu: 72%/60%   9        ← still scaling
cloudcompare-hpa   cpu: 28%/60%   9        ← stabilizing
cloudcompare-hpa   cpu: 1%/60%    3        ← scaled back down
```

---

## Cost Summary

| Resource | Size | Monthly Cost |
|----------|------|-------------|
| DOKS (2 nodes) | s-2vcpu-2gb | $36 |
| Load Balancer | Standard | $12 |
| Container Registry | Starter | $5 |
| **Total** | | **$53/month** |

**Cost Optimization Opportunity:**
Right-sizing nodes to `s-1vcpu-1gb` based on actual pod usage (1-3m CPU, 27-36Mi RAM) reduces total to **$29/month** — a 45% cost saving with no performance impact at current scale.

**AWS Equivalent: ~$189/month — 72% more expensive**

---

## Troubleshooting

### Pods stuck in ImagePullBackOff
```bash
# Registry secret not in namespace — run this
doctl registry kubernetes-manifest | kubectl apply -f -
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
kubectl delete pods -n cloudcompare --all
```

### Pods stuck in ErrImagePull on Apple Silicon
```bash
# Rebuild image for amd64
docker buildx build --platform linux/amd64 \
  -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest \
  --push .
kubectl rollout restart deployment/cloudcompare -n cloudcompare
```

### HPA showing unknown
```bash
# Install metrics server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# Wait 2 minutes then check again
kubectl get hpa -n cloudcompare
```

### CI/CD pipeline failing with token error
```bash
# Regenerate DO API token and update GitHub secret
# cloud.digitalocean.com/account/api/tokens
# GitHub repo → Settings → Secrets → DIGITALOCEAN_ACCESS_TOKEN
```

---

*Prepared by Pooja Mandava — Sr. Technical Account Manager*
*For support or questions reach out via your DigitalOcean TAM channel*
