# CloudCompare — Customer Setup Guide

**Prepared by:** Pooja Mandava, Sr. Technical Account Manager  
**Product:** CloudCompare — DigitalOcean vs AWS Cost Advisor  
**Live URL:** http://138.197.62.176

---

## Introduction

This guide walks your team through deploying CloudCompare on DigitalOcean Kubernetes (DOKS) from scratch. CloudCompare is a production-grade SaaS application that helps your team compare cloud infrastructure costs between DigitalOcean and AWS across multiple workload types and scales.

By the end of this guide your team will have:
- A fully containerized Node.js application running on Kubernetes
- A DigitalOcean Load Balancer distributing traffic across 2 pods
- Horizontal Pod Autoscaler automatically scaling based on CPU usage
- A CI/CD pipeline that deploys every code change automatically
- A private container registry storing your Docker images securely

---

## Deployment Flow
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
Kubernetes Deployment → 2 Pods running CloudCompare (Node.js)
↓
Horizontal Pod Autoscaler (scales pods 2→5 based on CPU @ 60%)
↓
Kubernetes Service (LoadBalancer)
↓
User accesses via EXTERNAL-IP (138.197.62.176)
```

---

## Before You Begin

You will need:
- A **DigitalOcean account** with billing set up
- A **GitHub account**
- A **DigitalOcean API token** — generate one at [cloud.digitalocean.com/account/api/tokens](https://cloud.digitalocean.com/account/api/tokens)
- Basic familiarity with the command line/terminal

---

## Choose Your Operating System

> Follow the complete guide for your OS from start to finish.

| [🍎 macOS](#-macos) | [🪟 Windows](#-windows) | [🐧 Linux (Ubuntu)](#-linux-ubuntu) |
|---|---|---|

---

## 🍎 macOS

### Step 1: Install Tools

**Homebrew** (package manager — skip if already installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Verify
brew --version
```

**Node.js**
```bash
brew install node

# Verify
node --version
# Expected: v18.x.x or higher
```

**Docker Desktop**
```bash
brew install --cask docker
```
> Open **Docker Desktop** from Applications and wait for green "Engine Running" status in menu bar before continuing.
```bash
# Verify
docker --version
# Expected: Docker version 24.x.x or higher
```

**kubectl**
```bash
brew install kubectl

# Verify
kubectl version --client
```

**doctl (DigitalOcean CLI)**
```bash
brew install doctl

# Verify
doctl version
```

**Git**
```bash
# Check if already installed
git --version

# Install if needed
brew install git
```

---

### Step 2: Authenticate with DigitalOcean
```bash
# Initialize doctl with your API token
doctl auth init
# Paste your API token when prompted

# Verify
doctl account get
```

**Expected Output:**
```
User Email                    Team       Status
your@email.com                My Team    active
```

---

### Step 3: Clone the Repository
```bash
git clone https://github.com/Poojamandava-DO/cloudcompare.git
cd cloudcompare
```

---

### Step 4: Create Container Registry

A private registry stores your Docker images securely inside DigitalOcean's network — faster pulls and no public exposure.
```bash
doctl registry create cloudcompare-registry --region nyc3

# Authenticate Docker with DOCR
doctl registry login
```

---

### Step 5: Build and Push Docker Image
```bash
# Build for linux/amd64 — required for DOKS nodes
# Apple Silicon (M1/M2/M3) builds arm64 by default
# DOKS runs amd64 Linux — this flag ensures compatibility
docker buildx build --platform linux/amd64 \
  -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest \
  --push .
```

---

### Step 6: Create DOKS Cluster

**Option A — Using doctl (Recommended)**
```bash
doctl kubernetes cluster create cloudcompare-cluster \
  --region nyc3 \
  --version latest \
  --node-pool "name=cloudcompare-pool;size=s-1vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" \
  --wait
```

**Option B — Using DigitalOcean Console**
1. Go to [cloud.digitalocean.com/kubernetes](https://cloud.digitalocean.com/kubernetes)
2. Click **Create Kubernetes Cluster**
3. Configure:
   - Region: NYC3
   - Version: Latest stable
   - Node Pool: s-1vcpu-2gb, Min 2, Max 3, Autoscaling enabled
4. Click **Create Cluster** and wait for provisioning
```bash
# Connect kubectl to your cluster
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

### Step 7: Connect Registry to Cluster
```bash
# Create registry pull secret in cluster
doctl registry kubernetes-manifest | kubectl apply -f -

# Create dedicated namespace for app isolation
kubectl create namespace cloudcompare

# Grant namespace permission to pull from registry
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
```

---

### Step 8: Deploy the Application
```bash
# Apply in order — ConfigMap first, pods need it before starting
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
```

---

### Step 9: Install Metrics Server

Required for HPA to read CPU usage. Without it HPA shows `<unknown>`.
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Wait 2 minutes then verify
kubectl get hpa -n cloudcompare
```

**Expected Output:**
```
NAME               TARGETS       MINPODS   MAXPODS   REPLICAS
cloudcompare-hpa   cpu: 1%/60%   2         5         2
```

---

### Step 10: Verify Deployment
```bash
# All 3 pods should show 1/1 Running
kubectl get pods -n cloudcompare

# Copy the EXTERNAL-IP — this is your live app URL
kubectl get services -n cloudcompare

# Check actual resource usage
kubectl top pods -n cloudcompare
```

**Expected Output:**
```
NAME                            READY   STATUS    RESTARTS   AGE
cloudcompare-65cb59cc59-bg4jh   1/1     Running   0          5m
cloudcompare-65cb59cc59-cv44m   1/1     Running   0          5m
cloudcompare-65cb59cc59-ltmsp   1/1     Running   0          5m
```

Open your browser and visit the **EXTERNAL-IP** to confirm the app is live! ✅

---

### Step 11: Set Up CI/CD Pipeline
```bash
# Add GitHub secret
# Go to: github.com/YOUR-REPO/settings/secrets/actions
# Add: DIGITALOCEAN_ACCESS_TOKEN = your DO API token

# Test by pushing any change
git add .
git commit -m "test: trigger ci/cd pipeline"
git push origin main

# Watch pipeline at: github.com/YOUR-REPO/actions
```

---

### Step 12: Load Testing
```bash
# Install k6
brew install k6

# Run load test — 150 virtual users for 3 minutes
k6 run --vus 150 --duration 3m k6-load-test.js

# Watch HPA scale in real time (open new terminal tab)
kubectl get hpa -n cloudcompare --watch
```

**Expected HPA Behavior:**
```
TARGETS         REPLICAS
cpu: 1%/60%     3        ← idle
cpu: 54%/60%    3        ← load increasing
cpu: 115%/60%   6        ← scaled up!
cpu: 72%/60%    9        ← still scaling
cpu: 1%/60%     3        ← scaled back down after load
```

---

## 🪟 Windows

### Step 1: Install Tools

**Chocolatey** (package manager — open PowerShell as Administrator)
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Verify
choco --version
```

**Node.js**
```powershell
choco install nodejs

# Verify
node --version
```

**Docker Desktop**

Download and install from: https://www.docker.com/products/docker-desktop

> Open **Docker Desktop** and wait for it to show "Engine Running" before continuing.
```powershell
# Verify
docker --version
```

**kubectl**
```powershell
choco install kubernetes-cli

# Verify
kubectl version --client
```

**doctl**
```powershell
choco install doctl

# Verify
doctl version
```

**Git**
```powershell
choco install git

# Verify
git --version
```

---

### Step 2: Authenticate with DigitalOcean
```powershell
doctl auth init
# Paste your API token when prompted

# Verify
doctl account get
```

---

### Step 3: Clone the Repository
```powershell
git clone https://github.com/Poojamandava-DO/cloudcompare.git
cd cloudcompare
```

---

### Step 4: Create Container Registry
```powershell
doctl registry create cloudcompare-registry --region nyc3
doctl registry login
```

---

### Step 5: Build and Push Docker Image
```powershell
# Windows Docker Desktop runs amd64 by default — no platform flag needed
docker build -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest .
docker push registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest
```

---

### Step 6: Create DOKS Cluster
```powershell
doctl kubernetes cluster create cloudcompare-cluster `
  --region nyc3 `
  --version latest `
  --node-pool "name=cloudcompare-pool;size=s-1vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" `
  --wait

# Connect kubectl
doctl kubernetes cluster kubeconfig save cloudcompare-cluster

# Verify
kubectl get nodes
```

---

### Step 7: Connect Registry to Cluster
```powershell
doctl registry kubernetes-manifest | kubectl apply -f -
kubectl create namespace cloudcompare
kubectl patch serviceaccount default -n cloudcompare `
  -p '{\"imagePullSecrets\": [{\"name\": \"registry-cloudcompare-registry\"}]}'
```

---

### Step 8: Deploy the Application
```powershell
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
```

---

### Step 9: Install Metrics Server
```powershell
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Wait 2 minutes then verify
kubectl get hpa -n cloudcompare
```

---

### Step 10: Verify Deployment
```powershell
kubectl get pods -n cloudcompare
kubectl get services -n cloudcompare
kubectl top pods -n cloudcompare
```

Open browser at the **EXTERNAL-IP** to confirm app is live! ✅

---

### Step 11: Set Up CI/CD Pipeline
```powershell
# Add DIGITALOCEAN_ACCESS_TOKEN to GitHub secrets
# github.com/YOUR-REPO/settings/secrets/actions

# Test pipeline
git add .
git commit -m "test: trigger ci/cd pipeline"
git push origin main
```

---

### Step 12: Load Testing
```powershell
choco install k6
k6 run --vus 150 --duration 3m k6-load-test.js

# Watch HPA in new terminal
kubectl get hpa -n cloudcompare --watch
```

---

## 🐧 Linux (Ubuntu)

### Step 1: Install Tools

**Update packages**
```bash
sudo apt-get update && sudo apt-get upgrade -y
```

**Node.js**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
```

**Docker**
```bash
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
```

**kubectl**
```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Verify
kubectl version --client
```

**doctl**
```bash
cd ~
wget https://github.com/digitalocean/doctl/releases/download/v1.100.0/doctl-1.100.0-linux-amd64.tar.gz
tar xf ~/doctl-1.100.0-linux-amd64.tar.gz
sudo mv ~/doctl /usr/local/bin

# Verify
doctl version
```

**Git**
```bash
sudo apt-get install -y git

# Verify
git --version
```

---

### Step 2: Authenticate with DigitalOcean
```bash
doctl auth init
# Paste your API token when prompted

# Verify
doctl account get
```

---

### Step 3: Clone the Repository
```bash
git clone https://github.com/Poojamandava-DO/cloudcompare.git
cd cloudcompare
```

---

### Step 4: Create Container Registry
```bash
doctl registry create cloudcompare-registry --region nyc3
doctl registry login
```

---

### Step 5: Build and Push Docker Image
```bash
# Linux builds amd64 by default — matches DOKS nodes
docker build -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest .
docker push registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest
```

---

### Step 6: Create DOKS Cluster
```bash
doctl kubernetes cluster create cloudcompare-cluster \
  --region nyc3 \
  --version latest \
  --node-pool "name=cloudcompare-pool;size=s-1vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" \
  --wait

# Connect kubectl
doctl kubernetes cluster kubeconfig save cloudcompare-cluster

# Verify
kubectl get nodes
```

---

### Step 7: Connect Registry to Cluster
```bash
doctl registry kubernetes-manifest | kubectl apply -f -
kubectl create namespace cloudcompare
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
```

---

### Step 8: Deploy the Application
```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
```

---

### Step 9: Install Metrics Server
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Wait 2 minutes then verify
kubectl get hpa -n cloudcompare
```

---

### Step 10: Verify Deployment
```bash
kubectl get pods -n cloudcompare
kubectl get services -n cloudcompare
kubectl top pods -n cloudcompare
```

Open browser at the **EXTERNAL-IP** to confirm app is live! ✅

---

### Step 11: Set Up CI/CD Pipeline
```bash
# Add DIGITALOCEAN_ACCESS_TOKEN to GitHub secrets
# github.com/YOUR-REPO/settings/secrets/actions

# Test pipeline
git add .
git commit -m "test: trigger ci/cd pipeline"
git push origin main
```

---

### Step 12: Load Testing
```bash
# Install k6
sudo apt-get install k6

# Run load test
k6 run --vus 150 --duration 3m k6-load-test.js

# Watch HPA in new terminal
kubectl get hpa -n cloudcompare --watch
```

---

## Cost Summary

| Resource | Size | Monthly Cost |
|----------|------|-------------|
| DOKS (2 nodes) | s-1vcpu-2gb | $36 |
| Load Balancer | Standard | $12 |
| Container Registry | Starter | $5 |
| **Total** | | **$41/month** |

**

**AWS Equivalent: ~$189/month — 72% more expensive**

---

## Troubleshooting

### Pods stuck in ImagePullBackOff
```bash
doctl registry kubernetes-manifest | kubectl apply -f -
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
kubectl delete pods -n cloudcompare --all
```

### ErrImagePull on Apple Silicon Mac
```bash
docker buildx build --platform linux/amd64 \
  -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest \
  --push .
kubectl rollout restart deployment/cloudcompare -n cloudcompare
```

### HPA showing unknown
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# Wait 2 minutes
kubectl get hpa -n cloudcompare
```

### CI/CD pipeline failing with token error
```
Regenerate DO API token at cloud.digitalocean.com/account/api/tokens
Update GitHub secret: Settings → Secrets → DIGITALOCEAN_ACCESS_TOKEN
```

---

*Prepared by Pooja Mandava — Sr. Technical Account Manager*  
*For support or questions reach out via your DigitalOcean TAM channel*
