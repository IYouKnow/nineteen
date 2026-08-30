package main

import (
	"fmt"

	"nineteen-server/auth"
	"nineteen-server/db"
)

func main() {
	db.Init("./data/nineteen.db")
	defer db.Close()

	for _, id := range []int{13, 11} {
		var prov, tok string
		db.DB.QueryRow("SELECT provider, access_token FROM integrations WHERE id = ?", id).Scan(&prov, &tok)
		plain, err := auth.DecryptToken(tok)
		if err != nil {
			fmt.Printf("id=%d DECRYPT ERROR: %v\n", id, err)
		} else {
			fmt.Printf("id=%d DECRYPT OK len=%d\n", id, len(plain))
		}
	}
}
