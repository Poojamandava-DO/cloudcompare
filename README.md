# ☁️ CloudCompare — DigitalOcean vs AWS Cost Advisor

A production-grade SaaS application deployed on DigitalOcean Kubernetes (DOKS) that helps developers and startups compare cloud infrastructure costs between DigitalOcean and AWS across multiple workload types and scales.

**🌐 Live Demo:** http://138.197.62.176

---

## Table of Contents
- [Deployment Flow](#deployment-flow)
- [Prerequisites](#prerequisites)
- [Step 1: Build and Push Docker Image](#step-1-build-and-push-docker-image)
- [Step 2: Create DOKS Cluster](#step-2-create-doks-cluster)
- [Step 3: Connect Registry to DOKS](#step-3-connect-registry-to-doks)
- [Step 4: Create Namespace and Deploy](#step-4-create-namespace-and-deploy)
- [Step 5: Install Metrics Server](#step-5-install-metrics-server)
- [Step 6: Verify Deployment](#step-6-verify-deployment)
- [Step 7: Load Testing](#step-7-load-testing)
- [API Endpoints](#api-endpoints)
- [CICD Pipeline](#cicd-pipeline)
- [Cost Analysis](#cost-analysis)
- [Best Practices](#best-practices)

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

- DigitalOcean account with billing set up
- `doctl` installed and authenticated (`doctl auth init`)
- `kubectl` installed
- Docker installed and running

---

## Step 1: Build and Push Docker Image
```bash
# Clone the repository
git clone https://github.com/Poojamandava-DO/cloudcompare.git
cd cloudcompare

# Create a private container registry in DigitalOcean
# Keeps images secure and co-located with DOKS for faster pulls
doctl registry create cloudcompare-registry --region nyc3

# Authenticate Docker with DOCR
doctl registry login

# Build for linux/amd64 — critical if building on Apple Silicon (M1/M2/M3)
# DOKS nodes run amd64 Linux — arm64 images will fail with platform mismatch
docker buildx build --platform linux/amd64 \
  -t registry.digitalocean.com/cloudcompare-registry/cloudcompare:latest \
  --push .
```

---

## Step 2: Create DOKS Cluster

### Option A: Using doctl (Recommended)
```bash
# --wait blocks until cluster is fully ready before proceeding
# s-2vcpu-2gb gives enough headroom for 3 pods with resource limits
doctl kubernetes cluster create cloudcompare-cluster \
  --region nyc3 \
  --version latest \
  --node-pool "name=cloudcompare-pool;size=s-2vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" \
  --wait
```

### Option B: Using DigitalOcean Console
1. Go to [DOKS Console](https://cloud.digitalocean.com/kubernetes)
2. Click **Create Kubernetes Cluster**
3. Set:
   - Region: NYC3
   - Version: Latest stable
   - Node Pool: s-2vcpu-2gb, Min 2, Max 3, Autoscaling enabled
4. Click **Create Cluster**

---

## Step 3: Connect Registry to DOKS
```bash
# Creates a Kubernetes secret with DOCR credentials
# Allows DOKS to pull private images without manual authentication
doctl registry kubernetes-manifest | kubectl apply -f -

# Isolate app resources from system workloads
# Best practice — never deploy apps into the default namespace
kubectl create namespace cloudcompare

# Grant the namespace permission to use the registry secret
kubectl patch serviceaccount default -n cloudcompare \
  -p '{"imagePullSecrets": [{"name": "registry-cloudcompare-registry"}]}'
```

---

## Step 4: Create Namespace and Deploy
```bash
# ConfigMap first — pods need environment variables before starting
kubectl apply -f k8s/configmap.yaml

# Deployment — runs 3 replicas with health probes and resource limits
kubectl apply -f k8s/deployment.yaml

# Service — creates DigitalOcean Load Balancer with a public IP
kubectl apply -f k8s/service.yaml

# HPA — watches CPU and scales pods automatically between 3 and 10
kubectl apply -f k8s/hpa.yaml
```

---

## Step 5: Install Metrics Server
```bash
# HPA requires the metrics server to read CPU usage from pods
# Without this, HPA shows <unknown> and cannot make scaling decisions
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## Step 6: Verify Deployment
```bash
# All 3 pods should show 1/1 Running
kubectl get pods -n cloudcompare

# CPU target should show actual percentage, not <unknown>
kubectl get hpa -n cloudcompare

# Copy the EXTERNAL-IP — that is your live app URL
kubectl get services -n cloudcompare
```

### Expected Output
```bash
kubectl get pods -n cloudcompare
NAME                            READY   STATUS    RESTARTS   AGE
cloudcompare-65cb59cc59-bg4jh   1/1     Running   0          14m
cloudcompare-65cb59cc59-cv44m   1/1     Running   0          14m
cloudcompare-65cb59cc59-ltmsp   1/1     Running   0          14m

kubectl get hpa -n cloudcompare
NAME               REFERENCE                 TARGETS       MINPODS   MAXPODS   REPLICAS
cloudcompare-hpa   Deployment/cloudcompare   cpu: 1%/60%   3         10        3

kubectl get services -n cloudcompare
NAME                   TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)
cloudcompare-service   LoadBalancer   10.108.61.174   138.197.62.176   80:31896/TCP
```

---

## Step 7: Load Testing
```bash
# Install k6 — open source load testing tool
brew install k6

# Run load test with 150 virtual users for 3 minutes
# Simulates a real traffic spike to trigger HPA autoscaling
k6 run --vus 150 --duration 3m k6-load-test.js
```

### Load Test Results

| Metric | Result |
|--------|--------|
| Virtual Users | 150 |
| Duration | 3 minutes |
| Peak CPU | 115% |
| Error Rate | 0% |
| HPA Scale Up | 3 → 9 pods automatically |
| HPA Scale Down | 9 → 3 pods after load dropped |

> HPA scaled from 3 to 9 pods automatically when CPU hit 115% — zero manual intervention required.

---

## API Endpoints

| Method | Endpoint | Description | Used By |
|--------|----------|-------------|---------|
| GET | `/` | Frontend UI | Users |
| POST | `/compare` | Compare DO vs AWS costs | Users |
| GET | `/products` | List supported workloads | Users |
| GET | `/health` | Liveness probe | Kubernetes |
| GET | `/ready` | Readiness probe | Kubernetes |
| GET | `/metrics` | App performance metrics | Monitoring |

### Example Request
```bash
curl -X POST http://138.197.62.176/compare \
  -H "Content-Type: application/json" \
  -d '{"workload": "web_app", "tier": "medium"}'
```

### Example Response
```json
{
  "workload": "Web Application",
  "tier": "medium",
  "users": "up to 10,000",
  "digitalocean": { "total_monthly_cost": "$115" },
  "aws": { "total_monthly_cost": "$287" },
  "savings": {
    "percentage": "60%",
    "monthly_savings": "$172",
    "annual_savings": "$2064"
  },
  "recommendation": "DigitalOcean saves you $172/month ($2064/year) compared to AWS for this workload."
}
```

---

## CI/CD Pipeline

Every push to `main` automatically triggers:
```
Push to GitHub
      ↓
GitHub Actions runner spins up
      ↓
Build Docker image (linux/amd64)
      ↓
Push to DigitalOcean Container Registry
      ↓
Connect to DOKS cluster via doctl
      ↓
Apply Kubernetes manifests
      ↓
Rolling update — zero downtime
      ↓
Verify rollout success
```

**Required GitHub Secret:**
- `DIGITALOCEAN_ACCESS_TOKEN` — your DO API token (Settings → Secrets → Actions)

---

## Cost Analysis

| Resource | Monthly Cost | Notes |
|----------|-------------|-------|
| DOKS (2 nodes, s-2vcpu-2gb) | $36 | Control plane is free — saves $73/month vs EKS |
| DigitalOcean Load Balancer | $12 | Included DDoS protection |
| Container Registry | $5 | Private, co-located with DOKS |
| **Total** | **$53/month** | |

**AWS equivalent: ~$189/month — 72% more expensive**

> HPA scales pods down during off-peak hours — you only pay for compute you actually use.

---

## Best Practices

| Practice | Implementation | Why It Matters |
|----------|---------------|----------------|
| Multi-stage Docker build | Builder stage + slim production stage | Reduces image size, removes dev dependencies from production |
| Non-root container user | Runs as `appuser` not `root` | Limits blast radius if container is compromised |
| Resource requests & limits | 100m/128Mi requests, 250m/256Mi limits | Required for HPA to work; prevents one pod starving others |
| Liveness probe `/health` | Checked every 10s, 3 failures = restart | Kubernetes auto-restarts crashed pods — self-healing |
| Readiness probe `/ready` | Checked every 5s before receiving traffic | Prevents traffic hitting pods that aren't fully started |
| HPA @ 60% CPU threshold | Scale up at 60%, not 80% or 90% | Gives Kubernetes 60-90s lead time to spin pods before saturation |
| Min 3 replicas | Always 3 pods running | 1 pod crashes — 2 still serve traffic. Zero downtime. |
| Rolling update strategy | maxSurge: 1, maxUnavailable: 0 | New pod ready before old one terminates — zero downtime deploys |
| Private DOCR | Images in DO registry, not Docker Hub | Faster pulls (same network), no public exposure |
| Namespace isolation | `cloudcompare` namespace | App resources isolated from Kubernetes system workloads |
| ConfigMap for config | ENV vars injected at runtime | Change config without rebuilding Docker image |
| Secret template | `secret.yaml.example` with placeholders | Sensitive values never committed to version control |
| CI/CD automation | GitHub Actions on every push | Zero manual deployments — consistent, repeatable releases |

---

## Author

**Pooja Mandava**
Sr. Technical Account Manager
[GitHub](https://github.com/Poojamandava-DO) · [LinkedIn](https://linkedin.com/in/poojamandava)

*Deployed on DigitalOcean Kubernetes as part of Senior TAM interview assignment.*
