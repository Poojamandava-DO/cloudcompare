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
- [Step 5: Verify Metrics Server](#step-5-verify-metrics-server)
- [Step 6: Verify Deployment](#step-6-verify-deployment)
- [Step 7: Load Testing](#step-7-load-testing)
- [API Endpoints](#api-endpoints)
- [CI/CD Pipeline](#cicd-pipeline)
- [Cost Analysis](#cost-analysis)
- [Best Practices](#best-practices)
- [Documentation](#documentation)

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
# s-1vcpu-2gb gives enough headroom for 3 pods with resource limits
doctl kubernetes cluster create cloudcompare-cluster \
  --region nyc3 \
  --version latest \
  --node-pool "name=cloudcompare-pool;size=s-1vcpu-2gb;count=2;auto-scale=true;min-nodes=2;max-nodes=3" \
  --wait
```

### Option B: Using DigitalOcean Console
1. Go to [DOKS Console](https://cloud.digitalocean.com/kubernetes)
2. Click **Create Kubernetes Cluster**
3. Set:
   - Region: NYC3
   - Version: Latest stable
   - Node Pool: s-1vcpu-2gb, Min 2, Max 3, Autoscaling enabled
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

# Deployment — runs 2 replicas with health probes and resource limits
kubectl apply -f k8s/deployment.yaml

# Service — creates DigitalOcean Load Balancer with a public IP
kubectl apply -f k8s/service.yaml

# HPA — watches CPU and scales pods automatically between 2 and 5
kubectl apply -f k8s/hpa.yaml
```

---

## Step 5: Verify Metrics Server
```bash
# DOKS comes with metrics-server pre-installed — no manual setup needed
# Verify it is running:
kubectl get deployment metrics-server -n kube-system
```

---

## Step 6: Verify Deployment
```bash
# All 2 pods should show 1/1 Running
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

kubectl get hpa -n cloudcompare
NAME               REFERENCE                 TARGETS       MINPODS   MAXPODS   REPLICAS
cloudcompare-hpa   Deployment/cloudcompare   cpu: 1%/60%   2         5         2

kubectl get services -n cloudcompare
NAME                   TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)
cloudcompare-service   LoadBalancer   10.108.61.174   138.197.62.176   80:31896/TCP
```

---

## Step 7: Load Testing
```bash
# Install k6 — open source load testing tool
brew install k6

# Run load test with 10 virtual users for 2 minutes
# Simulates a real traffic spike to trigger HPA autoscaling
k6 run --vus 10 --duration 2m k6-load-test.js
```

### Load Test Results

```
checks_total........: 2313     26.696716/s
checks_succeeded....: 100.00%  2313 out of 2313
checks_failed.......: 0.00%    0 out of 2313

✓ homepage status 200
✓ compare status 200
✓ savings returned

HTTP
http_req_duration...: avg=63.11ms min=45.82ms med=54.12ms max=502.26ms p(95)=124.39ms
http_req_failed.....: 0.00%   0 out of 1542
http_reqs...........: 1542    17.797811/s

EXECUTION
vus.................: 10      min=10 max=10
iterations..........: 765     8.829653/s

NETWORK
data_received.......: 6.1 MB  70 kB/s
data_sent...........: 184 kB  2.1 kB/s
```


| Metric | Result |
|--------|--------|
| Virtual Users | 10 |
| Duration | 2 minutes |
| Avg Response Time | 63.11ms |
| p95 Response Time | 124.39ms |
| Error Rate | 0% |
| Total Requests | 1,542 (17.8 req/sec) |
| Peak CPU | 195% |
| HPA Scale Up | 2 → 5 pods automatically |
| HPA Scale Down | 5 → 2 pods after load dropped |

HPA scaled from 2 to 5 pods automatically when CPU hit 360% — zero manual intervention required.

---

## API Endpoints

| Method | Endpoint | Description | Used By |
|--------|----------|-------------|---------|
| GET | `/` | Frontend UI | Users |
| POST | `/compare` | Compare DO vs AWS costs | Users |
| GET | `/products` | List supported workloads | Users |
| GET | `/health` | Liveness probe | Kubernetes |
| GET | `/ready` | Readiness probe | Kubernetes |

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

| Resource | DigitalOcean | AWS Equivalent | Savings |
|----------|-------------|----------------|---------|
| Kubernetes (2 nodes) | $24/mo | $144/mo (EKS) | $120/mo |
| Load Balancer | $12/mo | $22/mo (ALB) | $10/mo |
| Container Registry | $5/mo | $23/mo (ECR) | $18/mo |
| Control Plane | Free | $73/mo | $73/mo |
| **Total** | **$41/mo** | **$262/mo** | **$221/mo (84%)** |

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
| Min 2 replicas | Always 2 pods running | 1 pod crashes — 1 still serves traffic. Zero downtime. |
| Rolling update strategy | maxSurge: 1, maxUnavailable: 0 | New pod ready before old one terminates — zero downtime deploys |
| Private DOCR | Images in DO registry, not Docker Hub | Faster pulls (same network), no public exposure |
| Namespace isolation | `cloudcompare` namespace | App resources isolated from Kubernetes system workloads |
| ConfigMap for config | ENV vars injected at runtime | Change config without rebuilding Docker image |
| Secret template | `secret.yaml.example` with placeholders | Sensitive values never committed to version control |
| CI/CD automation | GitHub Actions on every push | Zero manual deployments — consistent, repeatable releases |

---

## Documentation

Full setup guide and QBR document are available in the `/docs` folder of this repository.

**Note:** Setup instructions have been tested on macOS. For Windows and Linux, the overall steps are the same — refer to the official DigitalOcean documentation for platform-specific CLI installation.

---

## Author

**Pooja Mandava**
Sr. Technical Account Manager

*Deployed on DigitalOcean Kubernetes — production-grade SaaS infrastructure demonstration.*
