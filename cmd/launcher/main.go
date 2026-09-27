package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var version = "4.0.0"

func getAppDir() string {
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		if _, err := os.Stat(filepath.Join(dir, "apps", "panel", "dist", "index.js")); err == nil {
			return dir
		}
	}
	cwd, err := os.Getwd()
	if err == nil {
		if _, err := os.Stat(filepath.Join(cwd, "apps", "panel", "dist", "index.js")); err == nil {
			return cwd
		}
	}
	if exePath != "" {
		return filepath.Dir(exePath)
	}
	return "."
}

func findNodeBinary(appDir string) (string, error) {
	var candidates []string
	if runtime.GOOS == "windows" {
		candidates = append(candidates,
			filepath.Join(appDir, "bin", "node.exe"),
			filepath.Join(appDir, "node.exe"),
		)
	} else {
		candidates = append(candidates,
			filepath.Join(appDir, "bin", "node"),
			filepath.Join(appDir, "node"),
		)
	}

	for _, cand := range candidates {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand, nil
		}
	}

	path, err := exec.LookPath("node")
	if err == nil {
		return path, nil
	}

	return "", fmt.Errorf("node runtime executable not found in bin/ or system PATH")
}

func streamLogs(r io.Reader, prefix string) {
	if r == nil {
		return
	}
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		fmt.Printf("[%s] %s\n", prefix, line)
	}
}

func startStaticWebServer(appDir string, webPort int, panelPort int) {
	webDist := filepath.Join(appDir, "apps", "web", "dist")
	if _, err := os.Stat(webDist); err != nil {
		return
	}

	panelURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", panelPort))
	proxy := httputil.NewSingleHostReverseProxy(panelURL)

	fs := http.FileServer(http.Dir(webDist))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/saki") || strings.HasPrefix(p, "/ws") || strings.HasPrefix(p, "/health") {
			proxy.ServeHTTP(w, r)
			return
		}

		targetFile := filepath.Join(webDist, filepath.Clean(p))
		fi, err := os.Stat(targetFile)
		if err != nil || fi.IsDir() {
			http.ServeFile(w, r, filepath.Join(webDist, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", webPort),
		Handler: handler,
	}

	go func() {
		_ = server.ListenAndServe()
	}()
}

func getEnvInt(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return fallback
	}
	return n
}

func pauseOnExit() {
	if runtime.GOOS == "windows" {
		fmt.Println("\nPress Enter to exit...")
		bufio.NewReader(os.Stdin).ReadBytes('\n')
	}
}

func main() {
	panelPortFlag := flag.Int("panel-port", getEnvInt("PANEL_PORT", 5479), "Panel API port")
	daemonPortFlag := flag.Int("daemon-port", getEnvInt("DAEMON_PORT", 5480), "Daemon service port")
	webPortFlag := flag.Int("web-port", getEnvInt("WEB_PORT", 5478), "Web UI port")
	showVersion := flag.Bool("version", false, "Print version")
	flag.BoolVar(showVersion, "v", false, "Print version (shorthand)")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Saki Panel v%s\n", version)
		return
	}

	fmt.Println("========================================================================")
	fmt.Printf("  🌸 Saki Panel v%s - The First AI-Powered Server Management Panel\n", version)
	fmt.Println("========================================================================")

	appDir := getAppDir()
	_ = os.Chdir(appDir)

	_ = os.MkdirAll(filepath.Join(appDir, "data", "panel"), 0755)
	_ = os.MkdirAll(filepath.Join(appDir, "data", "daemon"), 0755)
	_ = os.MkdirAll(filepath.Join(appDir, "workspace"), 0755)

	nodeBin, err := findNodeBinary(appDir)
	if err != nil {
		fmt.Println()
		fmt.Println("❌ [ERROR] Node.js runtime not found!")
		fmt.Println("   Saki Panel requires Node.js (>= 22.13).")
		fmt.Println("   Please install Node.js from https://nodejs.org or place node binary into bin/")
		fmt.Println()
		pauseOnExit()
		os.Exit(1)
	}

	panelScript := filepath.Join(appDir, "apps", "panel", "dist", "index.js")
	daemonScript := filepath.Join(appDir, "apps", "daemon", "dist", "index.js")

	if _, err := os.Stat(panelScript); err != nil {
		fmt.Printf("❌ [ERROR] Panel script not found: %s\n", panelScript)
		pauseOnExit()
		os.Exit(1)
	}
	if _, err := os.Stat(daemonScript); err != nil {
		fmt.Printf("❌ [ERROR] Daemon script not found: %s\n", daemonScript)
		pauseOnExit()
		os.Exit(1)
	}

	panelPort := *panelPortFlag
	daemonPort := *daemonPortFlag
	webPort := *webPortFlag

	fmt.Println("[+] Initializing runtime services...")
	fmt.Printf("[+] Using Node runtime: %s\n", nodeBin)
	fmt.Printf("[+] Web UI:    http://localhost:%d  (or http://localhost:%d)\n", webPort, panelPort)
	fmt.Printf("[+] Panel API: http://localhost:%d\n", panelPort)
	fmt.Printf("[+] Daemon:    http://localhost:%d\n", daemonPort)
	fmt.Println("[+] Default:   admin / admin123456")
	fmt.Println("========================================================================")
	fmt.Println("Press Ctrl+C to stop all services.")
	fmt.Println()

	startStaticWebServer(appDir, webPort, panelPort)

	var wg sync.WaitGroup
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	panelCmd := exec.CommandContext(ctx, nodeBin, panelScript)
	panelCmd.Dir = appDir
	panelCmd.Env = append(os.Environ(),
		fmt.Sprintf("PANEL_PORT=%d", panelPort),
		"NODE_ENV=production",
		"SAKI_IS_EXECUTABLE=1",
	)

	pOut, _ := panelCmd.StdoutPipe()
	pErr, _ := panelCmd.StderrPipe()
	go streamLogs(pOut, "Panel")
	go streamLogs(pErr, "Panel")

	if err := panelCmd.Start(); err != nil {
		log.Printf("[Panel] Failed to start: %v\n", err)
	} else {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = panelCmd.Wait()
		}()
	}

	daemonCmd := exec.CommandContext(ctx, nodeBin, daemonScript)
	daemonCmd.Dir = appDir
	daemonCmd.Env = append(os.Environ(),
		fmt.Sprintf("DAEMON_PORT=%d", daemonPort),
		fmt.Sprintf("PANEL_PORT=%d", panelPort),
		"NODE_ENV=production",
	)

	dOut, _ := daemonCmd.StdoutPipe()
	dErr, _ := daemonCmd.StderrPipe()
	go streamLogs(dOut, "Daemon")
	go streamLogs(dErr, "Daemon")

	if err := daemonCmd.Start(); err != nil {
		log.Printf("[Daemon] Failed to start: %v\n", err)
	} else {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = daemonCmd.Wait()
		}()
	}

	<-ctx.Done()
	fmt.Println("\n[+] Received shutdown signal, stopping Saki Panel...")

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		fmt.Println("[+] All services stopped cleanly. Goodbye! 🌸")
	case <-time.After(4 * time.Second):
		fmt.Println("[+] Force killing remaining processes...")
		if panelCmd.Process != nil {
			_ = panelCmd.Process.Kill()
		}
		if daemonCmd.Process != nil {
			_ = daemonCmd.Process.Kill()
		}
	}
}
