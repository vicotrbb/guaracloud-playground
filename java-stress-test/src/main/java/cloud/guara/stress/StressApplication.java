package cloud.guara.stress;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@SpringBootApplication
@RestController
public class StressApplication {

    private static final Logger logger = LoggerFactory.getLogger(StressApplication.class);

    public static void main(String[] args) {
        logger.info("Starting Java Stress Test application");
        SpringApplication.run(StressApplication.class, args);
    }

    @GetMapping("/")
    public Map<String, Object> stress(@RequestParam(defaultValue = "1000000") int limit) {
        logger.info("Received stress request with limit={}", limit);

        if (limit < 2) {
            logger.warn("Limit too small: {}, adjusting to 2", limit);
            limit = 2;
        }
        if (limit > 50000000) {
            logger.warn("Limit too large: {}, capping at 50000000", limit);
            limit = 50000000;
        }

        long startTime = System.currentTimeMillis();
        List<Integer> primes = sieveOfEratosthenes(limit);
        long elapsed = System.currentTimeMillis() - startTime;

        logger.info("Computed {} primes up to {} in {}ms", primes.size(), limit, elapsed);

        return Map.of(
            "message", "Hello from Java Stress Test!",
            "primesFound", primes.size(),
            "limit", limit,
            "elapsedMs", elapsed,
            "largestPrime", primes.get(primes.size() - 1)
        );
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        logger.debug("Health check requested");
        return Map.of("status", "ok");
    }

    private List<Integer> sieveOfEratosthenes(int limit) {
        boolean[] isComposite = new boolean[limit + 1];
        List<Integer> primes = new ArrayList<>();

        for (int i = 2; i <= limit; i++) {
            if (!isComposite[i]) {
                primes.add(i);
                for (long j = (long) i * i; j <= limit; j += i) {
                    isComposite[(int) j] = true;
                }
            }
        }

        return primes;
    }
}
