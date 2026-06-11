/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * @file lv_jpu.h
 *
 */

#ifndef LV_JPU_H
#define LV_JPU_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../lv_conf_internal.h"
#if LV_USE_RTK_JPU

/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * Register the JPU decoder functions in LVGL
 */
void lv_jpu_init(void);

void lv_jpu_deinit(void);

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_JPU*/

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /*LV_USE_JPU*/
