//go:build ignore
// +build ignore

package main

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
)

func main() {
	configPath := "config.toml"
	outFile := ".env"

	if len(os.Args) > 1 {
		configPath = os.Args[1]
	} else {
		// If running from scripts directory, it will find ../config.toml
		// If running from root directory (go run scripts/toml2env.go), it will fallback to config.toml
		if _, err := os.Stat("../config.toml"); err == nil {
			configPath = "../config.toml"
			outFile = "../.env"
		}
	}

	file, err := os.Open(configPath)
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", configPath, err)
		os.Exit(1)
	}
	defer file.Close()

	f, err := os.Create(outFile)
	if err != nil {
		fmt.Printf("Error creating %s: %v\n", outFile, err)
		os.Exit(1)
	}
	defer f.Close()

	scanner := bufio.NewScanner(file)
	var currentSection string

	// Regex to match [section] or [section.subsection]
	sectionRegex := regexp.MustCompile(`^\[([a-zA-Z0-9_\.]+)\]$`)
	// Regex to match key = value
	kvRegex := regexp.MustCompile(`^([a-zA-Z0-9_]+)\s*=\s*(.*)$`)

	var inArray bool
	var arrayKey string
	var arrayVals []string

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments unless inside array where we just ignore them
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Inline comments stripping
		if idx := strings.Index(line, " #"); idx != -1 {
			line = strings.TrimSpace(line[:idx])
		}

		if inArray {
			closed := false
			if strings.HasSuffix(line, "]") {
				closed = true
				line = strings.TrimSuffix(line, "]")
			}

			for p := range strings.SplitSeq(line, ",") {
				p = strings.TrimSpace(p)
				p = strings.Trim(p, `"'`)
				if p != "" {
					if !slices.Contains(arrayVals, p) {
						arrayVals = append(arrayVals, p)
					}
				}
			}

			if closed {
				inArray = false
				val := "[" + strings.Join(arrayVals, ",") + "]"

				safeVal := val
				if !strings.HasPrefix(val, "[") && (strings.Contains(val, " ") || strings.Contains(val, "#") || strings.Contains(val, "=")) {
					safeVal = fmt.Sprintf(`"%s"`, strings.ReplaceAll(val, `"`, `\"`))
				}
				lineOut := fmt.Sprintf("%s=%s\n", arrayKey, safeVal)
				f.WriteString(lineOut)
				fmt.Print(lineOut)
			}
			continue
		}

		if matches := sectionRegex.FindStringSubmatch(line); len(matches) == 2 {
			currentSection = strings.ToUpper(strings.ReplaceAll(matches[1], ".", "__"))
			continue
		}

		if matches := kvRegex.FindStringSubmatch(line); len(matches) == 3 {
			key := strings.ToUpper(matches[1])
			val := strings.TrimSpace(matches[2])

			envKey := key
			if currentSection != "" {
				envKey = currentSection + "__" + key
			}

			var found bool
			var foundEnd bool
			var innerVal string
			if innerVal, found = strings.CutPrefix(val, "["); found {
				if innerVal, foundEnd = strings.CutSuffix(innerVal, "]"); foundEnd {
					// Single line array
					var cleanParts []string
					for p := range strings.SplitSeq(innerVal, ",") {
						p = strings.TrimSpace(p)
						p = strings.Trim(p, `"'`)
						if p != "" && !slices.Contains(cleanParts, p) {
							cleanParts = append(cleanParts, p)
						}
					}
					val = "[" + strings.Join(cleanParts, ",") + "]"
				} else {
					// Multi-line array starts
					inArray = true
					arrayKey = envKey
					arrayVals = []string{}
					if innerVal != "" {
						for p := range strings.SplitSeq(innerVal, ",") {
							p = strings.TrimSpace(p)
							p = strings.Trim(p, `"'`)
							if p != "" && !slices.Contains(arrayVals, p) {
								arrayVals = append(arrayVals, p)
							}
						}
					}
					continue
				}
			} else {
				val = strings.Trim(val, `"'`)
			}

			safeVal := val
			if !strings.HasPrefix(val, "[") && (strings.Contains(val, " ") || strings.Contains(val, "#") || strings.Contains(val, "=")) {
				safeVal = fmt.Sprintf(`"%s"`, strings.ReplaceAll(val, `"`, `\"`))
			}

			lineOut := fmt.Sprintf("%s=%s\n", envKey, safeVal)
			f.WriteString(lineOut)
			fmt.Print(lineOut)
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Printf("Error scanning TOML: %v\n", err)
	}

	fmt.Printf("\nSuccessfully converted %s to %s\n", configPath, outFile)
}
