use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use raydium_clmm_cpi::{cpi, states::{AmmConfig, ObservationState, PoolState}};

use crate::VaultState;

#[derive(Accounts)]
pub struct SwapRaydium<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.admin == admin.key() @ crate::VaultError::Unauthorized,
        constraint = !vault_state.paused @ crate::VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = vault_state,
    )]
    pub vault_token_b_account: InterfaceAccount<'info, TokenAccount>,

    pub token_b_mint: InterfaceAccount<'info, Mint>,

    pub amm_config: Account<'info, AmmConfig>,

    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,

    #[account(mut)]
    pub pool_token_vault_0: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub pool_token_vault_1: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub observation_state: AccountLoader<'info, ObservationState>,

    pub pool_mint_0: InterfaceAccount<'info, Mint>,
    pub pool_mint_1: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,

    #[account(address = raydium_clmm_cpi::id())]
    /// CHECK: Raydium program ID is checked above.
    pub clmm_program: UncheckedAccount<'info>,
}

pub fn handler<'a, 'b, 'c: 'info, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, SwapRaydium<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    a_to_b: bool,
) -> Result<()> {
    require!(amount_in > 0, crate::VaultError::ZeroAmount);
    require!(min_amount_out > 0, crate::VaultError::ZeroAmount);

    // Student demo mode: never swap tokens backing user shares.
    require!(
        ctx.accounts.vault_state.total_shares == 0
            && ctx.accounts.vault_state.total_tokens == 0,
        crate::VaultError::Unauthorized
    );

    let state = &ctx.accounts.vault_state;
    let pool = ctx.accounts.pool_state.load()?;

    require_keys_eq!(
        pool.amm_config,
        ctx.accounts.amm_config.key(),
        crate::VaultError::InvalidPoolMint
    );
    require_keys_eq!(
        pool.observation_key,
        ctx.accounts.observation_state.key(),
        crate::VaultError::InvalidPoolMint
    );
    require_keys_eq!(
        pool.token_mint_0,
        ctx.accounts.pool_mint_0.key(),
        crate::VaultError::InvalidPoolMint
    );
    require_keys_eq!(
        pool.token_mint_1,
        ctx.accounts.pool_mint_1.key(),
        crate::VaultError::InvalidPoolMint
    );
    require_keys_eq!(
        pool.token_vault_0,
        ctx.accounts.pool_token_vault_0.key(),
        crate::VaultError::InvalidPoolMint
    );
    require_keys_eq!(
        pool.token_vault_1,
        ctx.accounts.pool_token_vault_1.key(),
        crate::VaultError::InvalidPoolMint
    );

    let my_mint = state.token_mint;
    let other_mint = ctx.accounts.token_b_mint.key();

    require!(
        (pool.token_mint_0 == my_mint && pool.token_mint_1 == other_mint)
            || (pool.token_mint_0 == other_mint && pool.token_mint_1 == my_mint),
        crate::VaultError::InvalidPoolMint
    );

    // a_to_b=true means MyToken -> Token B.
    let input_is_my_token = a_to_b;
    let input_account = if input_is_my_token {
        ctx.accounts.vault_token_account.to_account_info()
    } else {
        ctx.accounts.vault_token_b_account.to_account_info()
    };
    let output_account = if input_is_my_token {
        ctx.accounts.vault_token_b_account.to_account_info()
    } else {
        ctx.accounts.vault_token_account.to_account_info()
    };

    let input_mint = if input_is_my_token { my_mint } else { other_mint };
    let input_is_pool_zero = pool.token_mint_0 == input_mint;

    let (input_pool_vault, output_pool_vault, input_pool_mint, output_pool_mint) =
        if input_is_pool_zero {
            (
                ctx.accounts.pool_token_vault_0.to_account_info(),
                ctx.accounts.pool_token_vault_1.to_account_info(),
                ctx.accounts.pool_mint_0.to_account_info(),
                ctx.accounts.pool_mint_1.to_account_info(),
            )
        } else {
            (
                ctx.accounts.pool_token_vault_1.to_account_info(),
                ctx.accounts.pool_token_vault_0.to_account_info(),
                ctx.accounts.pool_mint_1.to_account_info(),
                ctx.accounts.pool_mint_0.to_account_info(),
            )
        };

    let bump = state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", my_mint.as_ref(), &[bump]]];

    let cpi_accounts = cpi::accounts::SwapSingleV2 {
        payer: ctx.accounts.vault_state.to_account_info(),
        amm_config: ctx.accounts.amm_config.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        input_token_account: input_account.clone(),
        output_token_account: output_account,
        input_vault: input_pool_vault,
        output_vault: output_pool_vault,
        observation_state: ctx.accounts.observation_state.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
        input_vault_mint: input_pool_mint,
        output_vault_mint: output_pool_mint,
    };

    cpi::swap_v2(
        CpiContext::new_with_signer(
            ctx.accounts.clmm_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        )
        .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
        amount_in,
        min_amount_out,
        0,
        true,
    )?;

    msg!(
        "Vault swap completed: amount_in={}, min_amount_out={}",
        amount_in,
        min_amount_out
    );

    Ok(())
}
