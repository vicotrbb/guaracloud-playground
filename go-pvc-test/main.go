package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type Item struct {
	ID        int    `json:"id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
}

type Store struct {
	Items  []Item `json:"items"`
	NextID int    `json:"next_id"`
}

var (
	store     Store
	mu        sync.Mutex
	storePath string
)

func getStorePath() string {
	dir := os.Getenv("STORAGE_PATH")
	if dir == "" {
		dir = "/tmp/pvc-data"
	}
	return filepath.Join(dir, "data.json")
}

func loadStore() error {
	data, err := os.ReadFile(storePath)
	if err != nil {
		if os.IsNotExist(err) {
			store = Store{Items: []Item{}, NextID: 1}
			log.Println("No existing data file found, starting fresh")
			return nil
		}
		return err
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return err
	}
	log.Printf("Loaded %d items from %s", len(store.Items), storePath)
	return nil
}

func saveStore() error {
	dir := filepath.Dir(storePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(storePath, data, 0644)
}

func respondJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		mu.Lock()
		defer mu.Unlock()
		log.Printf("GET / - Listing %d items", len(store.Items))
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"message": "Hello from Go PVC Test!",
			"items":   store.Items,
			"storage": storePath,
		})

	case http.MethodPost:
		var input struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			log.Printf("POST / - Bad request: %v", err)
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if input.Key == "" {
			log.Printf("POST / - Bad request: missing key")
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "key is required"})
			return
		}

		mu.Lock()
		defer mu.Unlock()
		item := Item{
			ID:        store.NextID,
			Key:       input.Key,
			Value:     input.Value,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		store.NextID++
		store.Items = append(store.Items, item)
		if err := saveStore(); err != nil {
			log.Printf("POST / - Failed to save: %v", err)
			respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save"})
			return
		}
		log.Printf("POST / - Created item %d: %s=%s", item.ID, item.Key, item.Value)
		respondJSON(w, http.StatusCreated, item)

	default:
		respondJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func handleItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/items/"):]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		log.Printf("%s /items/%s - Invalid id", r.Method, idStr)
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	mu.Lock()
	defer mu.Unlock()

	switch r.Method {
	case http.MethodGet:
		for _, item := range store.Items {
			if item.ID == id {
				log.Printf("GET /items/%d - Found: %s=%s", id, item.Key, item.Value)
				respondJSON(w, http.StatusOK, item)
				return
			}
		}
		log.Printf("GET /items/%d - Not found", id)
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})

	case http.MethodDelete:
		for i, item := range store.Items {
			if item.ID == id {
				store.Items = append(store.Items[:i], store.Items[i+1:]...)
				if err := saveStore(); err != nil {
					log.Printf("DELETE /items/%d - Failed to save: %v", id, err)
					respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save"})
					return
				}
				log.Printf("DELETE /items/%d - Deleted (key=%s)", id, item.Key)
				respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
				return
			}
		}
		log.Printf("DELETE /items/%d - Not found", id)
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})

	default:
		respondJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	log.Println("GET /health - Health check")
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func main() {
	storePath = getStorePath()
	log.Printf("Starting Go PVC Test")
	log.Printf("Storage path: %s", storePath)

	if err := loadStore(); err != nil {
		log.Fatalf("Failed to load store: %v", err)
	}

	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/items/", handleItem)
	http.HandleFunc("/health", handleHealth)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
